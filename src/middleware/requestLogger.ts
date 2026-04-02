/**
 * Request/Response Logging Middleware
 * Logs all incoming requests and outgoing responses with full tracing context.
 * Essential for debugging issues across 1000s of stores.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import type { CorrelationRequest } from './correlationId';

/**
 * Request Logger Middleware
 * Logs every request with full context for traceability
 */
export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationReq = req as CorrelationRequest;
  const startTime = correlationReq.requestStartTime || Date.now();

  // Log incoming request
  logger.debug(`Incoming request: ${req.method} ${req.originalUrl}`, {
    correlationId: correlationReq.correlationId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    storeId: correlationReq.storeId,
    contentLength: req.get('content-length'),
  });

  // Capture response data
  const originalSend = res.send;
  let responseBody: any;

  res.send = function (body: any): Response {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Parse response for error details if needed
    let errorMessage: string | undefined;
    if (statusCode >= 400 && responseBody) {
      try {
        const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
        errorMessage = parsed.message || parsed.error;
      } catch {
        // Not JSON, skip
      }
    }

    // Use async logging for audit trail (non-blocking)
    logger.httpLogAsync({
      correlationId: correlationReq.correlationId || 'unknown',
      method: req.method,
      path: req.originalUrl,
      statusCode,
      duration,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      storeId: correlationReq.storeId,
      userId: correlationReq.userId,
      error: errorMessage,
    });

    // Log slow requests (> 3 seconds)
    if (duration > 3000) {
      logger.warn(`Slow request detected: ${req.method} ${req.originalUrl}`, {
        correlationId: correlationReq.correlationId,
        duration,
        path: req.originalUrl,
        storeId: correlationReq.storeId,
      });
    }
  });

  next();
};

/**
 * Sanitize sensitive data from logs
 */
export const sanitizeForLogging = (data: any): any => {
  if (!data || typeof data !== 'object') return data;

  const sensitiveKeys = [
    'password', 'token', 'refreshToken', 'accessToken',
    'apiKey', 'secret', 'credential', 'authorization',
    'cardNumber', 'cvv', 'ssn', 'pin'
  ];

  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
};
