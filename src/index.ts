import app from './app';
import { config } from './config/env';
import { logger } from './services/logger';
import { initializeRateLimiterRedis } from './middleware/rateLimit';
import { disconnectRateLimiterRedis } from './config/redis';
import * as http from 'node:http';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import axios from 'axios';

const PORT = config.server.port;
const HOST = config.server.host;

async function startServer() {
  try {
    console.log('Starting POS API Gateway...');

    // Initialize async log queue for centralized logging
    console.log('Initializing async log queue...');
    await logger.initializeQueue();

    // Initialize Redis-based rate limiting
    console.log('Initializing Redis-based rate limiting...');
    const redisInitialized = await initializeRateLimiterRedis();
    if (redisInitialized) {
      console.log('✅ Redis rate limiting initialized');
    } else {
      console.warn('⚠️  Redis rate limiting unavailable, using in-memory fallback');
    }

    // Initialize service discovery
    console.log('Initializing service discovery...');
    
    // Create logs directory if it doesn't exist
    await Bun.write('logs/.gitkeep', '');
    
    // Create HTTP server from Express app
    const server = http.createServer(app);

    // ── WebSocket proxy: /ws → Core Service ws://localhost:5005/ws ──────────
    // Uses 'ws' package's handleUpgrade for proper node:http socket lifecycle
    // management. Auth verified via cookie (accessToken) or Authorization header
    // before any WebSocket frames are accepted.
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (req: http.IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      // Extract token from cookie or Authorization header
      let token: string | null = null;
      const cookieHeader = req.headers.cookie ?? '';
      for (const part of cookieHeader.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k.trim() === 'accessToken') { token = v.join('='); break; }
      }
      if (!token) token = url.searchParams.get("token");
      if (!token && typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
        token = req.headers.authorization.slice(7);
      }

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        await axios.get(`${config.services.authService.url}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000,
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }

      // Upgrade the client connection using ws (handles socket lifecycle correctly)
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const upstream = new WSClient('ws://localhost:5005/ws');

        upstream.on('open', () => {
          console.log('[WS] bridge established: client ↔ gateway ↔ core');
        });

        // Forward messages from Core Service → client
        upstream.on('message', (data, isBinary) => {
          if (clientWs.readyState === WSClient.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });

        // Forward messages from client → Core Service
        clientWs.on('message', (data, isBinary) => {
          if (upstream.readyState === WSClient.OPEN) {
            upstream.send(data, { binary: isBinary });
          }
        });

        upstream.on('close', (code, reason) => {
          if (clientWs.readyState === WSClient.OPEN) clientWs.close(code, reason);
        });
        upstream.on('error', () => {
          if (clientWs.readyState === WSClient.OPEN) clientWs.close(1011, 'upstream error');
        });

        clientWs.on('close', () => {
          if (upstream.readyState === WSClient.OPEN || upstream.readyState === WSClient.CONNECTING) {
            upstream.close();
          }
        });
        clientWs.on('error', () => upstream.terminate());
      });
    });
    // ────────────────────────────────────────────────────────────────────────

    server.listen(PORT, HOST, () => {
      console.log(`🌟 API Gateway running on http://${HOST}:${PORT}`);
      console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
      console.log(`📈 Metrics: http://${HOST}:${PORT}/metrics`);
      console.log(`🔧 Services status: http://${HOST}:${PORT}/services`);
      console.log(`📝 Environment: ${config.server.nodeEnv}`);
      console.log('');
      console.log('🔗 Available routes:');
      console.log('  Authentication:');
      console.log(`    POST http://${HOST}:${PORT}/api/auth/login`);
      console.log(`    POST http://${HOST}:${PORT}/api/auth/register`);
      console.log(`    GET  http://${HOST}:${PORT}/api/auth/me`);
      console.log('  User Management:');
      console.log(`    GET  http://${HOST}:${PORT}/api/users`);
      console.log(`    POST http://${HOST}:${PORT}/api/users`);
      console.log('  Store Management:');
      console.log(`    GET  http://${HOST}:${PORT}/api/stores`);
      console.log(`    POST http://${HOST}:${PORT}/api/stores`);
      console.log('  Services:');
      console.log(`    /api/auth/*      -> Authentication Service (port 3000)`);
      console.log(`    /api/users/*     -> Authentication Service (user management)`);
      console.log(`    /api/stores/*    -> Authentication Service (store management)`);
      console.log(`    /api/payments/*  -> Payment Service (port 3001)`);
      console.log(`    ws://localhost:${PORT}/ws  -> Core Service WebSocket (port 5005)`);
      console.log('');

      console.log('✅ API Gateway started successfully');
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down API Gateway...');

      server.close(async () => {
        // Disconnect rate limiter Redis
        await disconnectRateLimiterRedis();
        console.log('✅ Rate limiter Redis disconnected');

        console.log('✅ HTTP server closed');
        console.log('👋 API Gateway shutdown complete');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('❌ Failed to start API Gateway:', error);
    process.exit(1);
  }
}

// Handle startup errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception during startup:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection during startup:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();