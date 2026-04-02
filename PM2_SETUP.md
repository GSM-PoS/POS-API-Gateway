# PM2 Setup for POS API Gateway

## Overview
This document describes the PM2 setup for the POS API Gateway service.

## Files Added/Modified

### 1. `src/server.ts`
- Entry point for PM2 that loads environment variables before starting the application
- Ensures proper loading of .env file in PM2 environment
- Path: `/src/server.ts`

### 2. `ecosystem.config.js`
- PM2 configuration file that manages the application process
- Loads environment variables from .env file
- Configures logging, memory limits, and restart policies
- Path: `/ecosystem.config.js`

### 3. `package.json`
- Updated scripts section to use `server.ts` instead of `index.ts`
- Added PM2 management scripts:
  - `pm2:start` - Start the application with PM2
  - `pm2:stop` - Stop the application
  - `pm2:restart` - Restart the application
  - `pm2:logs` - View application logs
  - `pm2:delete` - Remove the application from PM2
  - `pm2:status` - Check application status
  - `pm2:monitor` - Open PM2 monitoring interface
- Added `dotenv` dependency for environment variable management

## Environment Variables
The following environment variables are required (defined in `.env`):

```env
# Server Configuration
NODE_ENV=development
PORT=8081
HOST=0.0.0.0

# Microservices URLs
AUTH_SERVICE_URL=http://localhost:3000
PAYMENT_SERVICE_URL=http://localhost:3001

# Service Timeouts (milliseconds)
AUTH_SERVICE_TIMEOUT=5000
PAYMENT_SERVICE_TIMEOUT=10000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

# CORS Configuration
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8081
CORS_CREDENTIALS=true

# Logging
LOG_LEVEL=info
```

## Usage

### Development
```bash
# Run in development mode with hot reload
bun run dev

# Run without hot reload
bun run start
```

### Production with PM2
```bash
# Start the application with PM2
bun run pm2:start

# Stop the application
bun run pm2:stop

# Restart the application
bun run pm2:restart

# View logs
bun run pm2:logs

# Check status
bun run pm2:status

# Monitor resources
bun run pm2:monitor

# Remove from PM2
bun run pm2:delete
```

### Building for Production
```bash
# Build the application
bun run build
```

## PM2 Features Configured

1. **Automatic Restarts**: Application will restart automatically if it crashes
2. **Memory Limit**: Restarts if memory usage exceeds 1GB
3. **Logging**: All logs are saved in the `logs/` directory:
   - `pm2-error.log` - Error logs
   - `pm2-out.log` - Standard output logs
   - `pm2-combined.log` - Combined logs with timestamps
4. **Environment Management**: Production environment variables are loaded from `.env`
5. **Process Name**: The application runs as `pos-api-gateway` in PM2

## Directory Structure
```
POS-Api-Gateway/
├── src/
│   ├── server.ts      # PM2 entry point
│   ├── index.ts       # Main application file
│   └── ...
├── logs/              # PM2 logs directory
├── ecosystem.config.js # PM2 configuration
├── package.json       # Updated with PM2 scripts
└── .env              # Environment variables
```

## Troubleshooting

1. **Application not starting**: Check logs with `bun run pm2:logs`
2. **Environment variables not loading**: Ensure `.env` file exists and has correct format
3. **Port already in use**: Check PORT setting in `.env` file
4. **Memory issues**: Adjust `max_memory_restart` in `ecosystem.config.js`

## Notes

- The server.ts file ensures that environment variables are loaded before the application starts
- PM2 will maintain the application running even after system restarts (if PM2 startup is configured)
- All PM2 commands can be run using the npm scripts defined in package.json