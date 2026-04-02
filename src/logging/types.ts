/**
 * Centralized Logging System - Type Definitions
 *
 * This module defines the unified log format used across all services.
 * Must match the types in POS-Authentication for cross-service compatibility.
 */

// Audit categories - matches database enum
export type AuditCategory =
  | 'AUTH'
  | 'SECURITY'
  | 'SETTINGS'
  | 'PAYMENT'
  | 'REFUND'
  | 'SYSTEM'
  | 'USER'
  | 'STORE';

// Audit severity levels - matches database enum
export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

// Source services
export type SourceService = 'api-gateway' | 'auth' | 'payment-server';

/**
 * Unified Log Entry - The standard format for all audit logs across services.
 * All services must use this format when pushing logs to the queue.
 */
export interface UnifiedLogEntry {
  // Identification
  id: string; // UUID for deduplication
  timestamp: string; // ISO 8601 with milliseconds
  correlation_id: string; // Request trace ID for end-to-end tracing
  source_service: SourceService; // Which service generated this log

  // Action details
  action: string; // e.g., REQUEST, PROXY, AUTH_CHECK, RATE_LIMIT
  category: AuditCategory;
  severity: AuditSeverity;

  // User context (optional)
  user_id?: string;
  user_email?: string;
  user_name?: string;

  // Store context (optional)
  store_id?: string;
  store_name?: string;

  // Request details (optional)
  request_method?: string; // GET, POST, PUT, DELETE
  request_path?: string; // /api/auth/login
  request_ip?: string;
  user_agent?: string;

  // Result
  success: boolean;
  error_message?: string;
  duration_ms?: number;

  // Resource being acted upon (optional)
  resource_type?: string; // e.g., 'user', 'transaction', 'refund'
  resource_id?: string;

  // Additional structured data
  details?: Record<string, unknown>;
}

/**
 * Log Queue Configuration
 */
export interface LogQueueConfig {
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  redisDb: number;
  queueName: string;
  deadLetterQueueName: string;
}

/**
 * Log Queue Health Status
 */
export interface LogQueueHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  queueDepth: number;
  redisConnected: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_QUEUE_CONFIG: Partial<LogQueueConfig> = {
  queueName: 'audit:logs',
  deadLetterQueueName: 'audit:logs:dlq',
};
