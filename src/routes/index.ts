import { Router } from 'express';
import { healthCheck } from '../middleware/monitoring';
import { serviceDiscovery } from '../services/serviceDiscovery';
import { ApiResponse } from '../utils';
import {
  authServiceProxy,
  paymentServiceProxy,
  coreServiceProxy,
  menuServiceProxy,
  notificationServiceProxy,
  integrationServiceProxy,
} from '../middleware/proxy';
import {
  authenticateWithAuthService,
  forwardUserData,
  type AuthenticatedRequest,
} from '../middleware/auth';
import {
  generalRateLimit,
  authRateLimit,
  strictRateLimit,
} from '../middleware/rateLimit';

const router = Router();

// Health route (no authentication required)
router.get('/health', healthCheck);

// Service discovery routes (authentication handled by auth service)
router.get('/services', 
  authRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json(new ApiResponse(403, null, 'System admin access required'));
    }
    const services = serviceDiscovery.getServices();
    return res.json(new ApiResponse(200, services, 'Services retrieved'));
  }
);

router.get('/services/:serviceName', 
  authRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  (req: AuthenticatedRequest, res) => {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json(new ApiResponse(403, null, 'System admin access required'));
    }
    
    const services = serviceDiscovery.getServices();
    const service = services.find(s => s.name === req.params.serviceName);
    
    if (!service) {
      return res.status(404).json(new ApiResponse(404, null, `Service ${req.params.serviceName} not found`));
    }
    
    return res.json(new ApiResponse(200, service, 'Service retrieved'));
  }
);

// Authentication service routes - let auth service handle everything
router.use('/api/auth', 
  authRateLimit,
  authServiceProxy
);

// User and store management routes (protected and handled by auth service)
router.use('/api/users',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);

router.use('/api/stores',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);

router.use('/api/settings',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);

// Audit service routes (protected, handled by auth service)
router.use('/api/audit',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);

// Auth service report subscription routes (must come before generic /api/reports)
router.use('/api/reports/subscriptions',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);
router.use('/api/reports/history',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);
router.use('/api/reports/send-now',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);
router.use('/api/reports/scheduler-status',
  generalRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  authServiceProxy
);

// Core Service routes
router.use('/api/orders', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/tables', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/sections', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/reservations', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/kitchen', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/customers', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/billing', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/reports', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/scheduling', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);
router.use('/api/sync/orders', generalRateLimit, authenticateWithAuthService, forwardUserData, coreServiceProxy);

// Menu Service routes
router.use('/api/menu', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/categories', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/modifiers', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/combos', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/inventory', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/suppliers', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);
router.use('/api/sync/menu', generalRateLimit, authenticateWithAuthService, forwardUserData, menuServiceProxy);

// Notification Service routes
router.use('/api/notifications', generalRateLimit, authenticateWithAuthService, forwardUserData, notificationServiceProxy);

// Integration Service routes
router.use('/api/integrations', generalRateLimit, authenticateWithAuthService, forwardUserData, integrationServiceProxy);

// Payment service routes (all protected)
// Route transaction endpoints
router.use('/api/payments/transactions',
  strictRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  paymentServiceProxy
);

// Route refund endpoints
router.use('/api/payments/refund',
  strictRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  paymentServiceProxy
);

router.use('/api/payments/refunds',
  strictRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  paymentServiceProxy
);

// Route other payment endpoints
router.use('/api/payments',
  strictRateLimit,
  authenticateWithAuthService,
  forwardUserData,
  paymentServiceProxy
);

// API documentation route
router.get('/api', (req, res) => {
  return res.json(new ApiResponse(200, {
    name: 'POS API Gateway',
    version: '1.0.0',
    services: ['auth', 'payment', 'core', 'menu'],
    endpoints: {
      auth: [
        'POST /api/auth/login',
        'POST /api/auth/refresh',
        'POST /api/auth/logout',
        'POST /api/auth/logout-all',
        'GET /api/auth/me',
        'POST /api/auth/change-password',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password'
      ],
      users: [
        'GET /api/users',
        'POST /api/users',
        'GET /api/users/:id',
        'PUT /api/users/:id',
        'DELETE /api/users/:id'
      ],
      stores: [
        'GET /api/stores',
        'POST /api/stores',
        'GET /api/stores/:id',
        'PUT /api/stores/:id',
        'DELETE /api/stores/:id',
        'GET /api/stores/:id/cc-data'
      ],
      settings: [
        'GET /api/settings',
        'GET /api/settings/cc-percentage',
        'PUT /api/settings/cc-percentage',
        'GET /api/settings/tax',
        'PUT /api/settings/tax'
      ],
      audit: [
        'GET /api/audit/logs',
        'GET /api/audit/stats',
        'GET /api/audit/export',
        'GET /api/audit/sessions',
        'DELETE /api/audit/sessions',
        'DELETE /api/audit/sessions/:id'
      ],
      reports: [
        'GET /api/reports/subscriptions',
        'POST /api/reports/subscriptions',
        'PUT /api/reports/subscriptions/:id',
        'DELETE /api/reports/subscriptions/:id',
        'GET /api/reports/history',
        'POST /api/reports/send-now',
        'GET /api/reports/scheduler-status'
      ],
      payments: [
        'POST /api/payments/transactions/sync',
        'GET /api/payments/transactions',
        'GET /api/payments/transactions/:id',
        'POST /api/payments/refund',
        'GET /api/payments/refunds'
      ],
      orders: [
        'GET /api/orders',
        'POST /api/orders',
        'GET /api/orders/:id',
        'PUT /api/orders/:id',
        'DELETE /api/orders/:id'
      ],
      tables: [
        'GET /api/tables',
        'POST /api/tables',
        'GET /api/tables/:id',
        'PUT /api/tables/:id',
        'DELETE /api/tables/:id'
      ],
      sections: [
        'GET /api/sections',
        'POST /api/sections',
        'GET /api/sections/:id',
        'PUT /api/sections/:id',
        'DELETE /api/sections/:id'
      ],
      reservations: [
        'GET /api/reservations',
        'POST /api/reservations',
        'GET /api/reservations/:id',
        'PUT /api/reservations/:id',
        'DELETE /api/reservations/:id'
      ],
      kitchen: [
        'GET /api/kitchen',
        'PUT /api/kitchen/:id'
      ],
      customers: [
        'GET /api/customers',
        'POST /api/customers',
        'GET /api/customers/:id',
        'PUT /api/customers/:id',
        'DELETE /api/customers/:id'
      ],
      billing: [
        'GET /api/billing',
        'POST /api/billing',
        'GET /api/billing/:id'
      ],
      coreReports: [
        'GET /api/reports',
        'GET /api/reports/:id'
      ],
      syncOrders: [
        'POST /api/sync/orders'
      ],
      menu: [
        'GET /api/menu',
        'POST /api/menu',
        'GET /api/menu/:id',
        'PUT /api/menu/:id',
        'DELETE /api/menu/:id'
      ],
      categories: [
        'GET /api/categories',
        'POST /api/categories',
        'GET /api/categories/:id',
        'PUT /api/categories/:id',
        'DELETE /api/categories/:id'
      ],
      modifiers: [
        'GET /api/modifiers',
        'POST /api/modifiers',
        'GET /api/modifiers/:id',
        'PUT /api/modifiers/:id',
        'DELETE /api/modifiers/:id'
      ],
      combos: [
        'GET /api/combos',
        'POST /api/combos',
        'GET /api/combos/:id',
        'PUT /api/combos/:id',
        'DELETE /api/combos/:id'
      ],
      inventory: [
        'GET /api/inventory',
        'POST /api/inventory',
        'GET /api/inventory/:id',
        'PUT /api/inventory/:id',
        'DELETE /api/inventory/:id'
      ],
      suppliers: [
        'GET /api/suppliers',
        'POST /api/suppliers',
        'GET /api/suppliers/:id',
        'PUT /api/suppliers/:id',
        'DELETE /api/suppliers/:id'
      ],
      syncMenu: [
        'POST /api/sync/menu'
      ]
    }
  }, 'API Gateway endpoints'));
});

// Fallback route for undefined endpoints
router.use((req, res) => {
  return res.status(404).json(new ApiResponse(404, null, `Route ${req.originalUrl} not found`));
});

export default router;