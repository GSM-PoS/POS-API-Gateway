# POS API Gateway

A comprehensive API Gateway for the Point of Sale (POS) system that provides centralized routing, authentication, rate limiting, and monitoring for all microservices.

## Features

- **🔐 Authentication & Authorization**: JWT-based authentication with role-based access control
- **🚦 Rate Limiting**: Configurable rate limiting with Redis support
- **🔍 Service Discovery**: Automatic health checking and service discovery
- **📊 Monitoring**: Request logging, metrics collection, and health checks
- **🛡️ Security**: Helmet security headers, CORS, input validation
- **⚡ Performance**: Request compression, response caching headers
- **🔄 Proxy**: Intelligent request routing to microservices
- **📈 Metrics**: Real-time performance metrics and service health

## Architecture

```
Client → API Gateway → Microservices
  ↓         ↓            ↓
Auth     Routing    Auth Service
Rate     Load       Inventory Service  
Limit    Balance    Order Service
         Monitor    Payment Service
                   Kitchen Service
                   Table Service
```

## Quick Start

### Prerequisites

- Bun runtime
- Redis (optional, for distributed rate limiting)
- Running microservices

### Installation

```bash
cd /Users/hompushparajmehta/Pushparaj/github/abhishek/POS-Api-Gateway
bun install
```

### Configuration

1. Copy and configure environment variables:
```bash
cp .env.example .env
```

2. Update service URLs in `.env`:
```env
AUTH_SERVICE_URL=http://localhost:3000
PAYMENT_SERVICE_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000,http://localhost:8080,http://localhost:19006
# ... etc
```

### Development

```bash
bun run dev
```

### Production

```bash
bun run build
bun run start
```

## API Routes

### Public Routes
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration  
- `POST /api/auth/refresh` - Token refresh
- `GET /health` - Gateway health check

### Protected Routes (Require Authentication)

#### User Management
- `GET /api/users` - List users (store admin+)
- `POST /api/users` - Create user (store admin+)
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (store admin+)

#### Store Management  
- `GET /api/stores` - List stores (store admin+)
- `POST /api/stores` - Create store (system admin only)
- `GET /api/stores/:id` - Get store details
- `PUT /api/stores/:id` - Update store
- `DELETE /api/stores/:id` - Delete store (system admin only)
- `GET /api/stores/:id/cc-data` - Get CC credentials (authorized only)

#### Microservice Proxies
- `/api/inventory/*` → Inventory Service
- `/api/orders/*` → Order Service  
- `/api/payments/*` → Payment Service
  - `POST /api/payments/transactions/sync` - Sync transaction from mobile app
  - `GET /api/payments/transactions` - Get all transactions with filters
  - `GET /api/payments/transactions/:id` - Get transaction by ID or GUID
  - `POST /api/payments/refund` - Process refund
  - `GET /api/payments/refunds` - Get all refunds with filters
- `/api/kitchen/*` → Kitchen Service
- `/api/tables/*` → Table Service

### Admin Routes (System Admin Only)
- `GET /metrics` - Gateway metrics
- `GET /services` - Service health status
- `GET /services/:serviceName` - Specific service health

## Authentication

The gateway uses JWT tokens for authentication. Include the token in requests:

```bash
curl -H "Authorization: Bearer <your-jwt-token>" \
     http://localhost:8080/api/users
```

### User Roles
- **system_admin**: Full access to all resources across all stores
- **store_admin**: Access to their assigned store's resources
- **user**: Basic user access

## Rate Limiting

Rate limits are applied per IP address and user agent:

- **General**: 1000 requests per 15 minutes
- **Authentication**: 10 attempts per 15 minutes  
- **Payments**: 30 requests per minute

## Service Discovery

The gateway automatically discovers and monitors microservice health:

- Health checks every 30 seconds
- Automatic failover for unhealthy services
- Real-time service status reporting

## Monitoring

### Health Check
```bash
curl http://localhost:8080/health
```

### Metrics
```bash
curl -H "Authorization: Bearer <admin-token>" \
     http://localhost:8080/metrics
```

### Logs
- `logs/combined.log` - All requests
- `logs/error.log` - Errors only

## Security Features

- **Helmet**: Security headers (CSP, HSTS, etc.)
- **CORS**: Configurable cross-origin policies
- **Input Validation**: Request validation and sanitization
- **Rate Limiting**: DDoS protection
- **JWT Verification**: Token-based authentication
- **Request Logging**: Audit trail with correlation IDs

## Configuration

Key environment variables:

```env
# Server
PORT=8080
HOST=0.0.0.0
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key

# Services
AUTH_SERVICE_URL=http://localhost:3000
INVENTORY_SERVICE_URL=http://localhost:3001
# ... etc

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:8081
```

## Development

### Project Structure
```
src/
├── config/          # Environment configuration
├── middleware/      # Auth, rate limiting, validation
├── routes/          # API route definitions  
├── services/        # Service discovery
├── utils/           # Shared utilities
├── app.ts          # Express app setup
└── index.ts        # Server entry point
```

### Adding a New Service

1. Add service URL to `config/env.ts`
2. Create proxy in `middleware/proxy.ts`
3. Add routes in `routes/index.ts`
4. Update service discovery in `services/serviceDiscovery.ts`

## Deployment

The gateway is designed for containerized deployment:

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json .
RUN bun install
COPY . .
EXPOSE 8080
CMD ["bun", "run", "start"]
```

## Contributing

1. Follow the established patterns for middleware and routing
2. Add proper validation for new endpoints
3. Include appropriate rate limiting
4. Update documentation for new features
5. Add health checks for new services