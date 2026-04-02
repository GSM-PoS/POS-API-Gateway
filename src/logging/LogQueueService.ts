/**
 * Log Queue Service for API Gateway
 *
 * Handles pushing logs to Redis queue for async processing.
 * Logs are processed by the centralized worker in POS-Authentication.
 *
 * Features:
 * - Non-blocking async log push (<1ms)
 * - Automatic fallback to console logging if Redis unavailable
 * - Health monitoring
 */

import { getRedisClient, isRedisConnected, disconnectRedis } from './redisClient';
import type { UnifiedLogEntry, LogQueueConfig, LogQueueHealth } from './types';

export class LogQueueService {
  private config: LogQueueConfig;
  private initialized = false;
  private stats = {
    totalPushed: 0,
    totalFailed: 0,
    lastPushTime: 0,
  };

  constructor(config: Partial<LogQueueConfig> & { redisHost: string; redisPort: number; redisDb: number }) {
    this.config = {
      redisHost: config.redisHost,
      redisPort: config.redisPort,
      redisPassword: config.redisPassword,
      redisDb: config.redisDb,
      queueName: config.queueName || 'audit:logs',
      deadLetterQueueName: config.deadLetterQueueName || 'audit:logs:dlq',
    };
  }

  /**
   * Initialize the queue service (connect to Redis)
   */
  async initialize(): Promise<boolean> {
    try {
      await getRedisClient(this.config);
      this.initialized = true;
      console.log(`[GW-LogQueue] Initialized - Queue: ${this.config.queueName}`);
      return true;
    } catch (error) {
      console.error('[GW-LogQueue] Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Push a single log entry to the queue (non-blocking)
   */
  async push(entry: UnifiedLogEntry): Promise<boolean> {
    const startTime = Date.now();

    try {
      if (!isRedisConnected()) {
        // Fallback: log to console if Redis not available
        this.logFallback(entry);
        return false;
      }

      const client = await getRedisClient(this.config);
      const serialized = JSON.stringify(entry);

      // LPUSH for FIFO order (worker uses BRPOP)
      await client.lPush(this.config.queueName, serialized);

      this.stats.totalPushed++;
      this.stats.lastPushTime = Date.now() - startTime;

      return true;
    } catch (error) {
      this.stats.totalFailed++;
      console.error('[GW-LogQueue] Push failed:', error);
      this.logFallback(entry);
      return false;
    }
  }

  /**
   * Get queue depth (number of pending logs)
   */
  async getQueueDepth(): Promise<number> {
    try {
      if (!isRedisConnected()) return -1;
      const client = await getRedisClient(this.config);
      return await client.lLen(this.config.queueName);
    } catch {
      return -1;
    }
  }

  /**
   * Get health status of the queue
   */
  async getHealth(): Promise<LogQueueHealth> {
    const queueDepth = await this.getQueueDepth();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!isRedisConnected()) {
      status = 'unhealthy';
    } else if (queueDepth > 10000) {
      status = 'degraded';
    }

    return {
      status,
      queueDepth: queueDepth >= 0 ? queueDepth : 0,
      redisConnected: isRedisConnected(),
    };
  }

  /**
   * Fallback logging when Redis is unavailable
   * Logs to console with structured format for later ingestion
   */
  private logFallback(entry: UnifiedLogEntry): void {
    const logLine = JSON.stringify({
      _fallback: true,
      _timestamp: new Date().toISOString(),
      ...entry,
    });

    // Log to stderr so it can be captured by log aggregators
    console.error(`[AUDIT_FALLBACK] ${logLine}`);
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await disconnectRedis();
    this.initialized = false;
    console.log('[GW-LogQueue] Shutdown complete');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized && isRedisConnected();
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

// Singleton instance for shared use
let logQueueInstance: LogQueueService | null = null;

/**
 * Get or create the singleton LogQueueService instance
 */
export function getLogQueueService(config?: Partial<LogQueueConfig> & { redisHost: string; redisPort: number; redisDb: number }): LogQueueService {
  if (!logQueueInstance && config) {
    logQueueInstance = new LogQueueService(config);
  }
  if (!logQueueInstance) {
    throw new Error('LogQueueService not initialized. Call with config first.');
  }
  return logQueueInstance;
}

/**
 * Initialize the global LogQueueService instance
 */
export async function initializeLogQueue(config: Partial<LogQueueConfig> & { redisHost: string; redisPort: number; redisDb: number }): Promise<LogQueueService> {
  const service = getLogQueueService(config);
  await service.initialize();
  return service;
}
