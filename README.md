# POS API Gateway

Central entry point for all POS microservices. Handles authentication, routing, rate limiting, and monitoring.

- **Runtime:** Bun
- **Framework:** Express.js
- **Port:** 8080

## Architecture

```
Client (Web / Mobile)
        ↓
   API Gateway :8080
        ↓
  ┌─────────────────────────────────────┐
  │  Auth Service    :3000              │
  │  Core Service    :5005              │
  │  Menu Service    :5003              │
  └─────────────────────────────────────┘
```

## Setup

```bash
bun install
cp .env.example .env
bun run dev
```

## Environment Variables

```env
PORT=8080
JWT_SECRET=your_jwt_secret
NODE_ENV=development

# Upstream services
AUTH_SERVICE_URL=http://localhost:3000
CORE_SERVICE_URL=http://localhost:5005
MENU_SERVICE_URL=http://localhost:5003

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:19006

# Redis (optional — for distributed rate limiting)
REDIS_URL=redis://localhost:6379

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

# Set true when running Playwright tests
SKIP_RATE_LIMIT=false
```

## API Routes

### Public (no auth required)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Login — returns JWT + sets cookie |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/health` | Gateway health check |

### Auth Service (proxied) — require auth

| Route | Proxied To |
|-------|------------|
| `/api/users/*` | Auth Service — user CRUD |
| `/api/stores/*` | Auth Service — store management |
| `/api/audit-logs/*` | Auth Service — audit logs |
| `/api/subscriptions/*` | Auth Service — report subscriptions |

### Core Service (proxied) — require auth

| Route | Proxied To |
|-------|------------|
| `/api/orders/*` | Core Service — orders + sync |
| `/api/tables/*` | Core Service — tables, sections, reservations + sync |
| `/api/kitchen/*` | Core Service — kitchen tickets + sync |
| `/api/billing/*` | Core Service — transactions, discounts, receipts, refunds + sync |
| `/api/reports/*` | Core Service — sales, staff, kitchen, revenue reports |
| `/api/customers/*` | Core Service — customer directory + sync |

### Menu Service (proxied) — require auth

| Route | Proxied To |
|-------|------------|
| `/api/menu/*` | Menu Service — categories, items, modifiers, combos |
| `/api/inventory/*` | Menu Service — inventory, suppliers, purchase orders |
| `/api/sync/menu` | Menu Service — mobile sync endpoint |

### WebSocket

| Route | Description |
|-------|-------------|
| `/ws` | Proxied to Core Service WebSocket (:5005) |

### Admin only

| Route | Description |
|-------|-------------|
| `GET /metrics` | Gateway performance metrics |
| `GET /services` | All service health status |
| `GET /services/:name` | Specific service health |

## Authentication

JWT in `Authorization` header or `HttpOnly` cookie. The gateway verifies the token then forwards the decoded user to upstream services.

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/orders
```

## Rate Limiting

| Scope | Limit |
|-------|-------|
| General | 1000 req / 15 min per IP+user |
| Auth endpoints | 10 req / 15 min |
| Payment endpoints | 30 req / min |

## PM2 Deployment

See [PM2_SETUP.md](./PM2_SETUP.md) for process management setup.

```bash
bun run build
bun run start
```

## Project Structure

```
src/
├── config/             # Environment config
├── middleware/         # Auth, rate limiting, proxy
├── routes/             # Route definitions
├── services/           # Service discovery + health checks
├── logging/            # Structured logging with correlation IDs
└── index.ts            # Entry point
```
