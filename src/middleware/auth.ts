import type { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { config } from '../config/env';
import { AppError } from '../utils';
import { logger } from '../services/logger';
import type { CorrelationRequest } from './correlationId';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role: 'super_admin' | 'system_admin' | 'store_admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen_staff' | 'self_order';
    store_id?: string;
  };
  correlationId?: string;
}

// Sanitize and validate user data before forwarding
const sanitizeHeaderValue = (value: string): string => {
  // Remove any characters that could be used for header injection
  return value.replace(/[\r\n\x00]/g, '').substring(0, 256);
};

const validateUserData = (user: any): boolean => {
  if (!user || typeof user !== 'object') {
    logger.debug('❌ User validation failed: not an object', { user });
    return false;
  }

  // Validate required fields
  if (!user.id || typeof user.id !== 'string') {
    logger.debug('❌ User validation failed: missing or invalid id', { userId: user.id });
    return false;
  }
  if (!user.email || typeof user.email !== 'string') {
    logger.debug('❌ User validation failed: missing or invalid email', { userEmail: user.email });
    return false;
  }
  if (!user.username || typeof user.username !== 'string') {
    logger.debug('❌ User validation failed: missing or invalid username', { username: user.username });
    return false;
  }
  if (!user.role || !['super_admin', 'system_admin', 'store_admin', 'manager', 'cashier', 'waiter', 'kitchen_staff', 'self_order'].includes(user.role)) {
    logger.debug('❌ User validation failed: missing or invalid role', { role: user.role });
    return false;
  }

  // Validate field formats
  if (!/^[a-zA-Z0-9-_]{1,50}$/.test(user.id)) {
    logger.debug('❌ User validation failed: id format invalid', { userId: user.id });
    return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
    logger.debug('❌ User validation failed: email format invalid', { userEmail: user.email });
    return false;
  }
  // Allow spaces in usernames (e.g., "Chubby Burger")
  if (!/^[a-zA-Z0-9_\- ]{1,50}$/.test(user.username)) {
    logger.debug('❌ User validation failed: username format invalid', {
      username: user.username,
      usernameLength: user.username.length,
      regexTest: /^[a-zA-Z0-9_\- ]{1,50}$/.test(user.username)
    });
    return false;
  }

  logger.debug('✅ User validation passed', {
    userId: user.id,
    username: user.username,
    role: user.role
  });

  return true;
};

/**
 * Role passthrough — Auth Service and Core Service now use the same 8-role system.
 * No mapping needed. Kept as function for logging clarity.
 */
const mapRoleForCoreService = (authRole: string): string => {
  return authRole;
};

// Forward user data to services by adding it to headers
export const forwardUserData = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as CorrelationRequest).correlationId || '';

  if (req.user && validateUserData(req.user)) {
    logger.debug('Forwarding user data to downstream service', {
      correlationId,
      path: req.originalUrl,
      userId: req.user.id,
      storeId: req.user.store_id,
    });

    // Only map roles for non-auth services (Core Service, Menu Service, etc.)
    // Auth Service routes (/api/users, /api/stores, /api/settings, /api/audit)
    // expect the original Auth Service role names
    const isAuthServiceRoute = req.originalUrl.startsWith('/api/users')
      || req.originalUrl.startsWith('/api/stores')
      || req.originalUrl.startsWith('/api/settings')
      || req.originalUrl.startsWith('/api/audit');
    const forwardedRole = isAuthServiceRoute
      ? req.user.role
      : mapRoleForCoreService(req.user.role);

    req.headers['x-user-id'] = sanitizeHeaderValue(req.user.id);
    req.headers['x-user-email'] = sanitizeHeaderValue(req.user.email);
    req.headers['x-user-username'] = sanitizeHeaderValue(req.user.username);
    req.headers['x-user-role'] = sanitizeHeaderValue(forwardedRole);
    if (req.user.store_id) {
      req.headers['x-user-store-id'] = sanitizeHeaderValue(req.user.store_id);
    }

    logger.debug('User headers set for downstream', {
      correlationId,
      userId: req.headers['x-user-id'] as string,
      username: req.headers['x-user-username'] as string,
      authRole: req.user.role,
      forwardedRole,
    });
  } else {
    logger.warn('No valid user data to forward', {
      correlationId,
      path: req.originalUrl,
    });
  }
  next();
};

// Verify token with auth service and get user data
export const authenticateWithAuthService = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const correlationId = (req as CorrelationRequest).correlationId || '';
  const startTime = Date.now();

  try {
    // SECURITY: Check for access token in HttpOnly cookie first (web clients)
    const cookieToken = req.cookies?.accessToken;
    const authHeader = req.headers.authorization;

    // Extract token from cookie or Authorization header
    let token: string | null = null;
    let authSource = 'unknown';

    if (cookieToken && typeof cookieToken === 'string') {
      token = cookieToken;
      authSource = 'cookie';
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
      authSource = 'header';
    }

    if (!token) {
      logger.securityLog({
        correlationId,
        event: 'auth_failure',
        ip: req.ip || '',
        path: req.originalUrl,
        reason: 'Missing authentication (no cookie or header)',
      });
      throw new AppError('Authentication required', 401);
    }

    logger.debug('Authenticating request with auth service', {
      correlationId,
      path: req.originalUrl,
      authSource,
    });

    // Forward the request to auth service to verify token and get user data
    const response = await axios.get(`${config.services.authService.url}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      timeout: config.services.authService.timeout
    });

    const duration = Date.now() - startTime;

    if (response.data.success && response.data.data) {
      const user = response.data.data;
      req.user = user;

      logger.securityLog({
        correlationId,
        event: 'auth_success',
        ip: req.ip || '',
        path: req.originalUrl,
        userId: user.id,
        storeId: user.store_id,
      });

      logger.debug('User authenticated successfully', {
        correlationId,
        userId: user.id,
        username: user.username,
        role: user.role,
        duration,
      });

      next();
    } else {
      throw new AppError('Invalid authentication response', 401);
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Authentication failed', {
      correlationId,
      path: req.originalUrl,
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        logger.securityLog({
          correlationId,
          event: 'auth_failure',
          ip: req.ip || '',
          path: req.originalUrl,
          reason: 'Invalid or expired token',
        });
        next(new AppError('Invalid or expired token', 401));
      } else if (error.response?.status === 404) {
        next(new AppError('Authentication endpoint not found', 503));
      } else {
        logger.error('Auth service error', {
          correlationId,
          statusCode: error.response?.status,
          error: error.response?.data,
        });
        next(new AppError('Authentication service unavailable', 503));
      }
    } else {
      next(error);
    }
  }
};