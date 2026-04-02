import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config/env';
import routes from './routes';
import { AppError } from './utils';
import { correlationIdMiddleware, extractStoreContext, type CorrelationRequest } from './middleware/correlationId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { logger } from './services/logger';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
const corsOptions = {
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Requested-With', 'X-Store-ID', 'X-Client-Type'],
  exposedHeaders: ['X-Correlation-ID', 'X-Served-By', 'X-Service', 'X-Store-ID']
};
app.use(cors(corsOptions));

// Cookie parser - MUST be before auth middleware to read HttpOnly cookies
app.use(cookieParser());

// Correlation ID - MUST be first for traceability across all requests
app.use(correlationIdMiddleware);

// Extract store context from headers/body/query for logging
app.use(extractStoreContext);

// Request logging - logs all requests with correlation ID
app.use(requestLoggerMiddleware);

// Body parsing middleware with security limits - but skip for proxy routes
app.use(compression());

// Only parse body for non-proxy routes (like /health, /api docs, etc.)
app.use((req, res, next) => {
  // Skip body parsing for routes that will be proxied
  if (req.url.startsWith('/api/auth') || req.url.startsWith('/api/users') || req.url.startsWith('/api/stores') || req.url.startsWith('/api/payments') || req.url.startsWith('/api/settings') || req.url.startsWith('/api/audit') || req.url.startsWith('/api/reports')) {
    return next();
  }
  
  // Parse body for other routes
  express.json({ 
    limit: '1mb',
    type: ['application/json', 'text/plain'],
    strict: true,
    verify: (req, res, buf) => {
      if (buf.length > 1024 * 1024) {
        throw new Error('Request too large');
      }
    }
  })(req, res, next);
});

app.use((req, res, next) => {
  // Skip body parsing for routes that will be proxied
  if (req.url.startsWith('/api/auth') || req.url.startsWith('/api/users') || req.url.startsWith('/api/stores') || req.url.startsWith('/api/payments') || req.url.startsWith('/api/settings') || req.url.startsWith('/api/audit') || req.url.startsWith('/api/reports')) {
    return next();
  }

  express.urlencoded({
    extended: true,
    limit: '1mb'
  })(req, res, next);
});

// Trust proxy for accurate IP addresses (important for rate limiting)
app.set('trust proxy', 1);

// API routes
app.use('/', routes);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const correlationReq = req as CorrelationRequest;
  const statusCode = err.statusCode || 500;
  const isDevelopment = config.server.nodeEnv === 'development';

  // Ensure CORS headers are present on error responses
  const origin = req.headers.origin;
  const allowedOrigins = Array.isArray(config.cors.origin) ? config.cors.origin : [config.cors.origin];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Sanitize error message to prevent information disclosure
  let message = 'Internal Server Error';
  if (statusCode < 500 || isDevelopment) {
    message = err.message || message;
  }

  // Log error with full context using structured logger
  logger.error(`Request error: ${err.message}`, {
    correlationId: correlationReq.correlationId,
    storeId: correlationReq.storeId,
    userId: correlationReq.userId,
    statusCode,
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    error: err.message,
    stack: err.stack,
  });

  // Don't leak error details in production
  const errorResponse: any = {
    success: false,
    statusCode,
    message,
    timestamp: new Date().toISOString(),
    path: req.path,
    correlationId: correlationReq.correlationId,
  };

  // Only include sensitive details in development
  if (isDevelopment) {
    errorResponse.stack = err.stack;
    errorResponse.details = err;
  }

  res.status(statusCode).json(errorResponse);
});

export default app;