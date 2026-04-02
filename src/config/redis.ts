/**
 * Redis Client for Rate Limiting
 * API Gateway - Separate Redis connection for rate limiting
 */

import { createClient, RedisClientType } from 'redis';
import { config } from './env';

let rateLimiterRedisClient: RedisClientType | null = null;
let isConnecting = false;

/**
 * Get or create Redis client for rate limiting
 */
export async function getRateLimiterRedisClient(): Promise<RedisClientType> {
  if (rateLimiterRedisClient && rateLimiterRedisClient.isOpen) {
    return rateLimiterRedisClient;
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    await new Promise(resolve => setTimeout(resolve, 100));
    if (rateLimiterRedisClient && rateLimiterRedisClient.isOpen) {
      return rateLimiterRedisClient;
    }
  }

  isConnecting = true;

  try {
    const url = config.redis.password
      ? `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}/${config.redis.db}`
      : `redis://${config.redis.host}:${config.redis.port}/${config.redis.db}`;

    rateLimiterRedisClient = createClient({
      url,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            console.error('[API-Gateway-RateLimiter] Max Redis reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          const delay = Math.min(retries * 100, 3000);
          console.log(`[API-Gateway-RateLimiter] Redis reconnecting in ${delay}ms (attempt ${retries})`);
          return delay;
        },
      },
    });

    rateLimiterRedisClient.on('error', (err: Error) => {
      console.error('[API-Gateway-RateLimiter] Redis client error:', err.message);
    });

    rateLimiterRedisClient.on('connect', () => {
      console.log('[API-Gateway-RateLimiter] Redis connected');
    });

    rateLimiterRedisClient.on('ready', () => {
      console.log('[API-Gateway-RateLimiter] Redis ready');
    });

    rateLimiterRedisClient.on('reconnecting', () => {
      console.log('[API-Gateway-RateLimiter] Redis reconnecting...');
    });

    await rateLimiterRedisClient.connect();
    console.log('[API-Gateway-RateLimiter] Redis connection established', {
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
    });

    return rateLimiterRedisClient;
  } catch (error) {
    console.error('[API-Gateway-RateLimiter] Failed to connect to Redis:', error);
    rateLimiterRedisClient = null;
    throw error;
  } finally {
    isConnecting = false;
  }
}

/**
 * Check if rate limiter Redis client is connected
 */
export function isRateLimiterRedisConnected(): boolean {
  return rateLimiterRedisClient !== null && rateLimiterRedisClient.isOpen;
}

/**
 * Disconnect rate limiter Redis client
 */
export async function disconnectRateLimiterRedis(): Promise<void> {
  if (rateLimiterRedisClient && rateLimiterRedisClient.isOpen) {
    await rateLimiterRedisClient.quit();
    rateLimiterRedisClient = null;
    console.log('[API-Gateway-RateLimiter] Redis disconnected');
  }
}

/**
 * Get current rate limiter Redis client
 */
export function getCurrentRateLimiterRedisClient(): RedisClientType | null {
  return rateLimiterRedisClient;
}
