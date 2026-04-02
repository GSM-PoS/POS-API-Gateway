interface Config {
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
  services: {
    authService: {
      url: string;
      timeout: number;
    };
    paymentService: {
      url: string;
      timeout: number;
    };
    coreService: {
      url: string;
      timeout: number;
    };
    menuService: {
      url: string;
      timeout: number;
    };
    notificationService: {
      url: string;
      timeout: number;
    };
    integrationService: {
      url: string;
      timeout: number;
    };
  };
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  rateLimiting: {
    windowMs: number;
    maxRequests: number;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
}

const getEnvVar = (key: string, defaultValue: string = ''): string => {
  return process.env[key] || defaultValue;
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  const parsed = value ? parseInt(value, 10) : defaultValue;
  return isNaN(parsed) ? defaultValue : parsed;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key]?.toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
};

export const config: Config = {
  server: {
    port: getEnvNumber('PORT', 8080),
    host: getEnvVar('HOST', '0.0.0.0'),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
  },
  services: {
    authService: {
      url: getEnvVar('AUTH_SERVICE_URL', 'http://localhost:3000'),
      timeout: getEnvNumber('AUTH_SERVICE_TIMEOUT', 5000),
    },
    paymentService: {
      url: getEnvVar('PAYMENT_SERVICE_URL', 'http://localhost:3001'),
      timeout: getEnvNumber('PAYMENT_SERVICE_TIMEOUT', 10000),
    },
    coreService: {
      url: getEnvVar('CORE_SERVICE_URL', 'http://localhost:5005'),
      timeout: getEnvNumber('CORE_SERVICE_TIMEOUT', 10000),
    },
    menuService: {
      url: getEnvVar('MENU_SERVICE_URL', 'http://localhost:5003'),
      timeout: getEnvNumber('MENU_SERVICE_TIMEOUT', 10000),
    },
    notificationService: {
      url: getEnvVar('NOTIFICATION_SERVICE_URL', 'http://localhost:5011'),
      timeout: getEnvNumber('NOTIFICATION_SERVICE_TIMEOUT', 10000),
    },
    integrationService: {
      url: getEnvVar('INTEGRATION_SERVICE_URL', 'http://localhost:5012'),
      timeout: getEnvNumber('INTEGRATION_SERVICE_TIMEOUT', 10000),
    },
  },
  cors: {
    origin: (() => {
      const corsOrigin = getEnvVar('CORS_ORIGINS');
      if (!corsOrigin) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('CORS_ORIGINS must be set in production environment');
        }
        return ['http://localhost:3000', 'http://localhost:5173'];
      }
      return corsOrigin.includes(',') ? corsOrigin.split(',') : corsOrigin;
    })(),
    credentials: getEnvBoolean('CORS_CREDENTIALS', true),
  },
  rateLimiting: {
    windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
    maxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 1000),
  },
  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: getEnvNumber('REDIS_PORT', 6379),
    password: getEnvVar('REDIS_PASSWORD') || undefined,
    db: getEnvNumber('REDIS_DB', 0),
  },
};