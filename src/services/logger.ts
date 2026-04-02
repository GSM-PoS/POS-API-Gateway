/**
 * Structured Logging Service for API Gateway
 * Provides consistent JSON-formatted logs for observability and tracing.
 *
 * Features:
 * - Async logging to Redis queue (non-blocking)
 * - Fallback to console if Redis unavailable
 * - Unified log format for cross-service tracing
 *
 * Log Format:
 * {
 *   timestamp: ISO string,
 *   level: 'debug' | 'info' | 'warn' | 'error',
 *   service: 'api-gateway',
 *   correlationId: string,
 *   storeId?: string,
 *   userId?: string,
 *   message: string,
 *   ...additionalContext
 * }
 */

import { config } from '../config/env';
import { LogQueueService, initializeLogQueue } from '../logging';
import type { UnifiedLogEntry, AuditCategory, AuditSeverity } from '../logging';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  correlationId?: string;
  storeId?: string;
  userId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
  targetService?: string;
  error?: string;
  stack?: string;
  [key: string]: any;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  storeId?: string;
  userId?: string;
  [key: string]: any;
}

class Logger {
  private serviceName = 'api-gateway';
  private logLevel: LogLevel;
  private logQueue: LogQueueService | null = null;
  private queueInitialized = false;

  constructor() {
    // Use LOG_LEVEL env var if set, otherwise default to 'debug' for all environments
    const envLevel = (process.env.LOG_LEVEL as LogLevel) || 'debug';
    this.logLevel = envLevel;
  }

  /**
   * Initialize the async log queue connection
   */
  async initializeQueue(): Promise<boolean> {
    try {
      this.logQueue = await initializeLogQueue({
        redisHost: config.redis.host,
        redisPort: config.redis.port,
        redisPassword: config.redis.password,
        redisDb: config.redis.db,
      });
      this.queueInitialized = true;
      console.log('[Logger] Async log queue initialized');
      return true;
    } catch (error) {
      console.error('[Logger] Failed to initialize log queue:', error);
      return false;
    }
  }

  /**
   * Check if async queue is ready
   */
  isQueueReady(): boolean {
    return this.queueInitialized && this.logQueue?.isInitialized() === true;
  }

  /**
   * Get queue health status
   */
  async getQueueHealth() {
    if (!this.logQueue) {
      return { status: 'unhealthy', queueDepth: 0, redisConnected: false };
    }
    return this.logQueue.getHealth();
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private formatLog(level: LogLevel, message: string, context?: LogContext): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
    };

    if (context) {
      // Extract primary identifiers
      if (context.correlationId) entry.correlationId = context.correlationId;
      if (context.storeId) entry.storeId = context.storeId;
      if (context.userId) entry.userId = context.userId;

      // Add remaining context
      const { correlationId, storeId, userId, ...rest } = context;
      Object.assign(entry, rest);
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    // In production, output JSON. In development, pretty print.
    if (config.server.nodeEnv === 'production') {
      console.log(JSON.stringify(entry));
    } else {
      const levelColors: Record<LogLevel, string> = {
        debug: '\x1b[36m', // cyan
        info: '\x1b[32m',  // green
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m', // red
      };
      const reset = '\x1b[0m';
      const color = levelColors[entry.level];

      const prefix = `${color}[${entry.level.toUpperCase()}]${reset}`;
      const correlationPrefix = entry.correlationId ? `[${entry.correlationId.slice(-12)}]` : '';
      const storePrefix = entry.storeId ? `[store:${entry.storeId.slice(0, 8)}]` : '';

      console.log(`${entry.timestamp} ${prefix}${correlationPrefix}${storePrefix} ${entry.message}`);

      // Print additional context for non-trivial logs
      const { timestamp, level, service, message, correlationId, storeId, userId, ...extra } = entry;
      if (Object.keys(extra).length > 0 && entry.level !== 'debug') {
        console.log('  ', JSON.stringify(extra, null, 2).replace(/\n/g, '\n  '));
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatLog('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.output(this.formatLog('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatLog('warn', message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      this.output(this.formatLog('error', message, context));
    }
  }

  /**
   * Log HTTP request/response for observability
   */
  httpLog(context: {
    correlationId: string;
    method: string;
    path: string;
    statusCode: number;
    duration: number;
    ip?: string;
    userAgent?: string;
    storeId?: string;
    userId?: string;
    targetService?: string;
    error?: string;
  }): void {
    const level: LogLevel = context.statusCode >= 500 ? 'error' :
                           context.statusCode >= 400 ? 'warn' : 'info';

    const message = `${context.method} ${context.path} ${context.statusCode} ${context.duration}ms`;

    this.output(this.formatLog(level, message, context));
  }

  /**
   * Log proxy request to downstream service
   */
  proxyLog(context: {
    correlationId: string;
    targetService: string;
    targetUrl: string;
    method: string;
    statusCode?: number;
    duration?: number;
    error?: string;
    storeId?: string;
    userId?: string;
  }): void {
    const level: LogLevel = context.error ? 'error' :
                           (context.statusCode && context.statusCode >= 500) ? 'error' :
                           (context.statusCode && context.statusCode >= 400) ? 'warn' : 'info';

    const status = context.statusCode ?? 'pending';
    const duration = context.duration ? `${context.duration}ms` : '';
    const message = `PROXY ${context.method} -> ${context.targetService} ${status} ${duration}`;

    this.output(this.formatLog(level, message.trim(), context));
  }

  /**
   * Log security events (authentication, authorization)
   * NOTE: Only security failures are stored in audit DB.
   * AUTH_SUCCESS is logged to console only (not DB) since it happens on every request.
   * Actual logins are tracked by auth service as LOGIN_SUCCESS.
   */
  securityLog(context: {
    correlationId: string;
    event: 'auth_success' | 'auth_failure' | 'access_denied' | 'rate_limited' | 'suspicious_activity';
    ip: string;
    path: string;
    userId?: string;
    storeId?: string;
    reason?: string;
  }): void {
    const level: LogLevel = context.event === 'auth_success' ? 'info' : 'warn';
    const message = `SECURITY ${context.event.toUpperCase()} - ${context.path} from ${context.ip}`;

    // Console output for all security events
    this.output(this.formatLog(level, message, {
      ...context,
      category: 'security',
    }));

    // Only push FAILURES to audit queue (not auth_success)
    // auth_success happens on every authenticated request - too noisy for audit DB
    // Real logins are tracked by auth service as LOGIN_SUCCESS
    if (context.event !== 'auth_success') {
      this.logAuditAsync({
        correlationId: context.correlationId,
        action: context.event.toUpperCase(),
        category: 'SECURITY',
        severity: 'WARNING',
        userId: context.userId,
        storeId: context.storeId,
        requestMethod: undefined,
        requestPath: context.path,
        requestIp: context.ip,
        success: false,
        errorMessage: context.reason,
        details: { event: context.event },
      });
    }
  }

  /**
   * Log HTTP request/response
   * NOTE: HTTP requests are logged to console only, NOT to audit DB.
   * Routine HTTP requests (200, 304, etc.) are too noisy for audit purposes.
   * Only errors (5xx) are stored in audit DB for incident tracking.
   */
  httpLogAsync(context: {
    correlationId: string;
    method: string;
    path: string;
    statusCode: number;
    duration: number;
    ip?: string;
    userAgent?: string;
    storeId?: string;
    userId?: string;
    targetService?: string;
    error?: string;
  }): void {
    // Console output for all requests
    this.httpLog(context);

    // Only push server errors (5xx) to audit DB for incident tracking
    // Routine requests (200, 304, 4xx) are NOT stored - too noisy
    if (context.statusCode >= 500) {
      this.logAuditAsync({
        correlationId: context.correlationId,
        action: 'HTTP_SERVER_ERROR',
        category: 'SYSTEM',
        severity: 'ERROR',
        userId: context.userId,
        storeId: context.storeId,
        requestMethod: context.method,
        requestPath: context.path,
        requestIp: context.ip,
        userAgent: context.userAgent,
        success: false,
        errorMessage: context.error,
        durationMs: context.duration,
        details: {
          statusCode: context.statusCode,
          targetService: context.targetService,
        },
      });
    }
  }

  /**
   * Log proxy request to downstream services
   * NOTE: Proxy requests are logged to console only, NOT to audit DB.
   * Only errors (5xx or explicit errors) are stored in audit DB.
   */
  proxyLogAsync(context: {
    correlationId: string;
    targetService: string;
    targetUrl: string;
    method: string;
    statusCode?: number;
    duration?: number;
    error?: string;
    storeId?: string;
    userId?: string;
  }): void {
    // Console output for all proxy requests
    this.proxyLog(context);

    // Only push errors to audit DB
    const isError = context.error || (context.statusCode && context.statusCode >= 500);
    if (isError) {
      this.logAuditAsync({
        correlationId: context.correlationId,
        action: 'PROXY_ERROR',
        category: 'SYSTEM',
        severity: 'ERROR',
        userId: context.userId,
        storeId: context.storeId,
        requestMethod: context.method,
        requestPath: context.targetUrl,
        success: false,
        errorMessage: context.error,
        durationMs: context.duration,
        details: {
          targetService: context.targetService,
          statusCode: context.statusCode,
        },
      });
    }
  }

  /**
   * Push log entry to async queue (non-blocking)
   * This method does NOT await - fire and forget for minimal latency
   */
  logAuditAsync(params: {
    correlationId: string;
    action: string;
    category: AuditCategory;
    severity: AuditSeverity;
    userId?: string;
    userEmail?: string;
    userName?: string;
    storeId?: string;
    storeName?: string;
    requestMethod?: string;
    requestPath?: string;
    requestIp?: string;
    userAgent?: string;
    success: boolean;
    errorMessage?: string;
    durationMs?: number;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
  }): void {
    if (!this.logQueue || !this.queueInitialized) {
      // Queue not ready, skip async logging (console output already done)
      return;
    }

    const entry: UnifiedLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      correlation_id: params.correlationId,
      source_service: 'api-gateway',
      action: params.action,
      category: params.category,
      severity: params.severity,
      user_id: params.userId,
      user_email: params.userEmail,
      user_name: params.userName,
      store_id: params.storeId,
      store_name: params.storeName,
      request_method: params.requestMethod,
      request_path: params.requestPath,
      request_ip: params.requestIp,
      user_agent: params.userAgent,
      success: params.success,
      error_message: params.errorMessage,
      duration_ms: params.durationMs,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      details: params.details,
    };

    // Fire and forget - don't await
    this.logQueue.push(entry).catch((err) => {
      console.error('[Logger] Failed to push to audit queue:', err);
    });
  }
}

// Export singleton instance
export const logger = new Logger();
