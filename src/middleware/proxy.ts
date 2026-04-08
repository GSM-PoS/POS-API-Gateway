import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Request, Response, NextFunction } from 'express';
import { serviceDiscovery } from '../services/serviceDiscovery';
import { AppError } from '../utils';
import { Request as ExpressRequest } from 'express';
import { IncomingMessage, ClientRequest } from 'http';
import { logger } from '../services/logger';
import type { CorrelationRequest } from './correlationId';

interface ProxyOptions {
  serviceName: string;
}

// Circuit Breaker implementation
class CircuitBreaker {
  private failures = 0;
  private lastFailTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly failureThreshold = 5;
  private readonly timeout = 60000; // 1 minute
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

// Circuit breakers for each service
const circuitBreakers = new Map<string, CircuitBreaker>();

const getCircuitBreaker = (serviceName: string): CircuitBreaker => {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, new CircuitBreaker());
  }
  return circuitBreakers.get(serviceName)!;
};

export const createServiceProxy = (options: ProxyOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const correlationReq = req as CorrelationRequest;
    const circuitBreaker = getCircuitBreaker(options.serviceName);
    const proxyStartTime = Date.now();

    // Log proxy start (debug only, no audit trail needed)
    logger.debug(`Proxy request to ${options.serviceName}`, {
      correlationId: correlationReq.correlationId,
      targetService: options.serviceName,
      path: req.originalUrl,
      method: req.method,
      storeId: correlationReq.storeId,
      userId: correlationReq.userId,
    });

    try {
      await circuitBreaker.execute(async () => {
        const serviceUrl = serviceDiscovery.getServiceUrl(options.serviceName);

        if (!serviceUrl) {
          logger.error(`Service unavailable: ${options.serviceName}`, {
            correlationId: correlationReq.correlationId,
            targetService: options.serviceName,
            storeId: correlationReq.storeId,
          });
          throw new AppError(`Service ${options.serviceName} is currently unavailable`, 503);
        }

        // Type assertion needed because http-proxy-middleware types don't include all valid options
        const proxyMiddleware = createProxyMiddleware({
          target: serviceUrl,
          changeOrigin: true,
          timeout: 10000,
          pathRewrite: (path: string, req: IncomingMessage) => {
            const expressReq = req as ExpressRequest;
            // For payment service, we need to rewrite paths to match the backend expectations
            let rewrittenPath = expressReq.originalUrl;

            if (options.serviceName === 'payment') {
              // Convert API Gateway paths to Payment Service paths
              rewrittenPath = rewrittenPath
                .replace('/api/payments/transactions/sync', '/api/transactions/sync')
                .replace('/api/payments/transactions', '/api/transactions')
                .replace('/api/payments/refund', '/api/refund')
                .replace('/api/payments/refunds', '/api/refunds')
                .replace('/api/payments/', '/api/');
            }

            logger.debug(`Path rewrite: ${path} → ${rewrittenPath}`, {
              correlationId: correlationReq.correlationId,
              targetService: options.serviceName,
            });
            return rewrittenPath;
          },
          on: {
            proxyReq: (proxyReq: ClientRequest, req: IncomingMessage) => {
              // Remove browser Origin header — upstream services should not handle CORS
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("referer");
              const expressReq = req as ExpressRequest;
              const correlationReq = req as CorrelationRequest;

              // Re-stream the body if it was already parsed by Express
              // This is necessary because body-parser consumes the stream
              if (expressReq.body && Object.keys(expressReq.body).length > 0) {
                const bodyData = JSON.stringify(expressReq.body);
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
              }

              // Forward correlation ID to downstream service
              if (correlationReq.correlationId) {
                proxyReq.setHeader('X-Correlation-ID', correlationReq.correlationId);
              }

              // Forward store context if available
              if (correlationReq.storeId) {
                proxyReq.setHeader('X-Store-ID', correlationReq.storeId);
              }

              // Forward user context if available
              if (correlationReq.userId) {
                proxyReq.setHeader('X-User-ID', correlationReq.userId);
              }

              // Forward ALL user headers set by forwardUserData middleware
              const userEmail = req.headers['x-user-email'];
              if (userEmail) {
                proxyReq.setHeader('x-user-email', userEmail as string);
              }

              const userName = req.headers['x-user-username'];
              if (userName) {
                proxyReq.setHeader('x-user-username', userName as string);
              }

              const userRole = req.headers['x-user-role'];
              if (userRole) {
                proxyReq.setHeader('x-user-role', userRole as string);
              }

              const userStoreId = req.headers['x-user-store-id'];
              if (userStoreId) {
                proxyReq.setHeader('x-user-store-id', userStoreId as string);
              }

              // Also forward as x-user-data JSON for downstream services that expect it
              const userId = req.headers['x-user-id'];
              if (userId && userEmail && userRole) {
                // Core Service uses numeric restaurant_id; map from Auth Service's UUID store_id
                // TODO: Replace with DB lookup when store mapping table is implemented
                // Super/system admins have no store — default to restaurant 1 for cross-restaurant access
                const adminRoles = ['super_admin', 'system_admin'];
                const restaurantId = userStoreId ? 1 : (adminRoles.includes(userRole as string) ? 1 : null);

                const userData = JSON.stringify({
                  id: userId,
                  email: userEmail,
                  role: userRole,
                  username: userName || '',
                  store_id: userStoreId || null,
                  restaurant_id: restaurantId,
                });
                proxyReq.setHeader('x-user-data', encodeURIComponent(userData));
              }

              // Forward client type for cookie-based auth (web vs mobile)
              const clientType = expressReq.get?.('X-Client-Type');
              if (clientType) {
                proxyReq.setHeader('X-Client-Type', clientType);
              }

              logger.debug(`Forwarding to ${options.serviceName}`, {
                correlationId: correlationReq.correlationId,
                targetService: options.serviceName,
                method: req.method,
                path: expressReq.originalUrl,
                userHeaders: {
                  email: !!userEmail,
                  username: !!userName,
                  role: !!userRole,
                  storeId: !!userStoreId,
                }
              });
            },
            proxyRes: (proxyRes: IncomingMessage, req: IncomingMessage) => {
              // Strip upstream CORS headers so the gateway CORS middleware controls them
              delete proxyRes.headers["access-control-allow-origin"];
              delete proxyRes.headers["access-control-allow-credentials"];
              delete proxyRes.headers["access-control-allow-methods"];
              delete proxyRes.headers["access-control-allow-headers"];
              const expressReq = req as ExpressRequest;
              const correlationReq = req as CorrelationRequest;
              const duration = Date.now() - proxyStartTime;

              // Use async logging for audit trail (non-blocking)
              logger.proxyLogAsync({
                correlationId: correlationReq.correlationId || 'unknown',
                targetService: options.serviceName,
                targetUrl: expressReq.originalUrl || req.url || '',
                method: req.method || 'UNKNOWN',
                statusCode: proxyRes.statusCode,
                duration,
                storeId: correlationReq.storeId,
                userId: correlationReq.userId,
              });
            },
            error: (err: Error, req: IncomingMessage) => {
              const expressReq = req as ExpressRequest;
              const correlationReq = req as CorrelationRequest;
              const duration = Date.now() - proxyStartTime;

              // Use async logging for audit trail (non-blocking)
              logger.proxyLogAsync({
                correlationId: correlationReq.correlationId || 'unknown',
                targetService: options.serviceName,
                targetUrl: expressReq.originalUrl || req.url || '',
                method: req.method || 'UNKNOWN',
                duration,
                error: err.message,
                storeId: correlationReq.storeId,
                userId: correlationReq.userId,
              });

              throw err;
            }
          }
        });

        return new Promise<void>((resolve, reject) => {
          proxyMiddleware(req, res, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      });
    } catch (error) {
      next(error);
    }
  };
};

export const authServiceProxy = createServiceProxy({
  serviceName: 'auth'
});

export const paymentServiceProxy = createServiceProxy({
  serviceName: 'payment'
});

export const coreServiceProxy = createServiceProxy({
  serviceName: 'core'
});

export const menuServiceProxy = createServiceProxy({
  serviceName: 'menu'
});

export const notificationServiceProxy = createServiceProxy({
  serviceName: 'notification'
});

export const integrationServiceProxy = createServiceProxy({
  serviceName: 'integration'
});