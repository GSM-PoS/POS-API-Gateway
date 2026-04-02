/**
 * Redis Client for Logging System
 *
 * Provides Redis connection management for the centralized logging queue.
 * Uses native Redis commands through the 'redis' package.
 */

import { createClient, type RedisClientType } from 'redis';
import type { LogQueueConfig } from './types';

let redisClient: RedisClientType | null = null;
let isConnecting = false;
let connectionPromise: Promise<RedisClientType> | null = null;

/**
 * Get or create Redis client instance
 */
export async function getRedisClient(config: LogQueueConfig): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  isConnecting = true;
  connectionPromise = connectRedis(config);

  try {
    redisClient = await connectionPromise;
    return redisClient;
  } finally {
    isConnecting = false;
    connectionPromise = null;
  }
}

/**
 * Connect to Redis with retry logic
 */
async function connectRedis(config: LogQueueConfig): Promise<RedisClientType> {
  const url = config.redisPassword
    ? `redis://:${config.redisPassword}@${config.redisHost}:${config.redisPort}/${config.redisDb}`
    : `redis://${config.redisHost}:${config.redisPort}/${config.redisDb}`;

  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          console.error('[GW-LogQueue] Max Redis reconnection attempts reached');
          return new Error('Max reconnection attempts reached');
        }
        const delay = Math.min(retries * 100, 3000);
        console.log(`[GW-LogQueue] Redis reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      },
    },
  });

  client.on('error', (err) => {
    console.error('[GW-LogQueue] Redis client error:', err.message);
  });

  client.on('connect', () => {
    console.log('[GW-LogQueue] Redis connected');
  });

  client.on('ready', () => {
    console.log('[GW-LogQueue] Redis ready');
  });

  client.on('reconnecting', () => {
    console.log('[GW-LogQueue] Redis reconnecting...');
  });

  await client.connect();
  return client as RedisClientType;
}

/**
 * Check if Redis client is connected
 */
export function isRedisConnected(): boolean {
  return redisClient !== null && redisClient.isOpen;
}

/**
 * Disconnect Redis client
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    console.log('[GW-LogQueue] Redis disconnected');
  }
}

/**
 * Get current Redis client (may be null if not connected)
 */
export function getCurrentRedisClient(): RedisClientType | null {
  return redisClient;
}
