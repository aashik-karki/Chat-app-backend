import http from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { createSessionManager } from './config/session.js';
import { logger } from './lib/logger.js';
import { registerChatGateway } from './realtime/chat-gateway.js';
import { attachSocketAuth } from './realtime/socket-auth.js';

const configureSocketAdapter = async (io: SocketIOServer) => {
  const pubClient = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 1000,
    retryStrategy: (attempt) => (attempt > 1 ? null : 100),
  });
  const subClient = pubClient.duplicate();
  pubClient.on('error', (error) => logger.warn({ error }, 'Socket.IO Redis publisher error'));
  subClient.on('error', (error) => logger.warn({ error }, 'Socket.IO Redis subscriber error'));

  try {
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter enabled');
    return [pubClient, subClient];
  } catch (error) {
    if (!env.ALLOW_INFRA_FAILURE) throw error;
    logger.warn({ error }, 'Redis unavailable; running Socket.IO without horizontal scaling');
    pubClient.disconnect();
    subClient.disconnect();
    return [];
  }
};

const start = async () => {
  await connectDatabase();
  const sessionManager = await createSessionManager();
  const app = createApp(sessionManager.middleware);
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ALLOW_ALL ? true : env.CLIENT_ORIGIN, credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });
  const redisClients = await configureSocketAdapter(io);

  // Shares the same HttpOnly session cookie the REST API uses, so a socket
  // handshake is authenticated exactly like an HTTP request (see
  // realtime/socket-auth.ts) — no separate token or login step.
  io.engine.use(sessionManager.middleware);
  attachSocketAuth(io);
  registerChatGateway(io);

  httpServer.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Chat backend started'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    io.close();
    httpServer.close(() => logger.info('HTTP server closed'));
    redisClients.forEach((client) => client.disconnect());
    await sessionManager.disconnect();
    await disconnectDatabase();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

void start().catch((error) => {
  logger.fatal({ error }, 'Failed to start chat backend');
  process.exit(1);
});
