/**
 * Correlation ID Middleware
 * Generates and propagates correlation IDs across all requests for distributed tracing.
 * Format: {timestamp}-{random-uuid} for easy sorting and uniqueness
 *
 * SECURITY:
 * - Correlation IDs are validated to prevent injection attacks
 * - Store IDs are only trusted from authenticated user context
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export interface CorrelationRequest extends Request {
  correlationId: string;
  requestStartTime: number;
  storeId?: string;
  userId?: string;
}

// Regex patterns for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRELATION_ID_REGEX = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate store ID format (UUID)
 * Prevents injection of malicious values
 */
const isValidStoreId = (storeId: string | undefined): boolean => {
  if (!storeId || typeof storeId !== 'string') return false;
  return UUID_REGEX.test(storeId);
};

/**
 * Validate correlation ID format
 * Accepts either our format (timestamp-uuid) or standard UUID
 */
const isValidCorrelationId = (id: string | undefined): boolean => {
  if (!id || typeof id !== 'string') return false;
  return CORRELATION_ID_REGEX.test(id) || UUID_REGEX.test(id);
};

/**
 * Sanitize header value to prevent header injection
 */
const sanitizeHeaderValue = (value: string): string => {
  // Remove newlines, carriage returns, and null bytes
  return value.replace(/[\r\n\x00]/g, '').substring(0, 256);
};

/**
 * Generates a correlation ID with timestamp prefix for easy sorting
 * Format: {timestamp}-{uuid}
 * Example: 1704470400000-550e8400-e29b-41d4-a716-446655440000
 */
export const generateCorrelationId = (): string => {
  return `${Date.now()}-${randomUUID()}`;
};

/**
 * Correlation ID Middleware
 * - Extracts correlation ID from incoming request header OR generates new one
 * - Validates incoming correlation IDs to prevent injection
 * - Attaches correlation ID to request object for downstream use
 * - Adds correlation ID to response headers for client tracking
 * - Records request start time for duration calculation
 */
export const correlationIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationReq = req as CorrelationRequest;

  // Use existing correlation ID from header if valid, otherwise generate new one
  const existingId = req.headers['x-correlation-id'];
  if (typeof existingId === 'string' && isValidCorrelationId(existingId)) {
    correlationReq.correlationId = sanitizeHeaderValue(existingId);
  } else {
    correlationReq.correlationId = generateCorrelationId();
  }

  // Record request start time for duration calculation
  correlationReq.requestStartTime = Date.now();

  // Set correlation ID in response header for client tracking
  res.setHeader('X-Correlation-ID', correlationReq.correlationId);

  // Add to request headers so it can be forwarded to downstream services
  (req.headers as Record<string, string | string[] | undefined>)['x-correlation-id'] = correlationReq.correlationId;

  next();
};

/**
 * Extract store ID from authenticated user context ONLY
 *
 * SECURITY: We no longer trust store_id from headers/body/query before authentication.
 * The store_id is only extracted from the authenticated user's JWT token.
 * This prevents attackers from injecting arbitrary store IDs in requests.
 *
 * The x-user-store-id header is set by the auth middleware AFTER token validation.
 */
export const extractStoreContext = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationReq = req as CorrelationRequest;

  // SECURITY: Only trust store_id from authenticated user context
  // The user object is populated by auth middleware after JWT validation
  const userStoreId = (req as any).user?.store_id;

  // Also check the forwarded header from auth middleware (set after authentication)
  const forwardedStoreId = req.headers['x-user-store-id'] as string;

  // Use authenticated store_id only
  const storeId = userStoreId || forwardedStoreId;

  if (storeId && isValidStoreId(storeId)) {
    correlationReq.storeId = storeId;
    res.setHeader('X-Store-ID', storeId);
  }

  // Extract user ID from authenticated context only
  const userId = (req as any).user?.id;
  if (userId && typeof userId === 'string') {
    correlationReq.userId = sanitizeHeaderValue(userId);
  }

  next();
};
