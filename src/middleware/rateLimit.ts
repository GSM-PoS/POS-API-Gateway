import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { config } from '../config/env';
import { getRateLimiterRedisClient } from '../config/redis';
import type { Request } from 'express';

/**
 * Key generator using IP + User ID to avoid shared IP rate limiting issues
 */
const getUserBasedKey = (req: Request): string => {
  const userId = (req as any).user?.id || (req.headers['x-user-id'] as string) || 'anonymous';
  return `${req.ip}-${userId}`;
};

/**
 * Redis client instance for rate limiting store
 * Will be initialized asynchronously
 */
let redisClient: any = null;

/**
 * Initialize Redis client for rate limiting
 */
export async function initializeRateLimiterRedis() {
  try {
    redisClient = await getRateLimiterRedisClient();
    console.log('[API-Gateway] Rate limiter Redis initialized successfully');
    return true;
  } catch (error) {
    console.error('[API-Gateway] Failed to initialize rate limiter Redis:', error);
    return false;
  }
}

/**
 * Create rate limit configuration with optional Redis store
 */
function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  prefix: string;
}) {
  const skipRateLimiting = config.server.nodeEnv === 'development' && process.env.SKIP_RATE_LIMIT === 'true';

  if (skipRateLimiting) {
    console.log(`[API-Gateway] Rate limiting DISABLED for ${options.prefix} (SKIP_RATE_LIMIT=true)`);
    return (req: any, res: any, next: any) => next();
  }

  const baseConfig = {
    windowMs: options.windowMs,
    max: options.max,
    message: {
      success: false,
      message: options.message,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserBasedKey,
  };

  // If Redis client is available, use Redis store
  if (redisClient) {
    return rateLimit({
      ...baseConfig,
      store: new RedisStore({
        // @ts-expect-error - RedisStore types don't match latest redis client
        client: redisClient,
        prefix: `api_gateway_${options.prefix}:`,
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      }),
    });
  } else {
    // Fallback to in-memory store
    console.warn(`[API-Gateway] Using in-memory rate limiting for ${options.prefix} (Redis unavailable)`);
    return rateLimit(baseConfig);
  }
}

/**
 * General rate limit for all API endpoints
 */
export const generalRateLimit = createRateLimiter({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  message: 'Too many requests, please try again later.',
  prefix: 'general',
});

/**
 * Strict rate limit for authentication endpoints
 */
export const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP+User to 100 auth requests per window
  message: 'Too many authentication attempts, please try again later.',
  prefix: 'auth',
});

/**
 * Strictest rate limit for sensitive operations
 */
export const strictRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP+User to 50 requests per window
  message: 'Rate limit exceeded for sensitive operations.',
  prefix: 'strict',
});