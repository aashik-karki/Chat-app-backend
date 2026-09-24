import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { RequestHandler } from 'express';
import { Server } from 'socket.io';
import { isStaff } from '../common/auth/permissions.js';
import { env } from '../core/config/env.js';
import { logger } from '../core/logger.js';
import { createRedisConnection, isRedisReady } from '../core/redis/redis.js';
import { rooms } from './rooms.js';
import { attachSocketAuth } from './socket-auth.middleware.js';
import type { AppServer, Gateway } from './socket.types.js';

interface CreateSocketServerOptions {
  httpServer: HttpServer;
  sessionMiddleware: RequestHandler;
}

/**
 * Creates the Socket.IO server.
 *
 * Horizontal scaling: with Redis available it uses the Redis *Streams*
 * adapter, so emits reach sockets on every server instance AND connection
 * state recovery works across instances (the classic pub/sub Redis adapter
 * does not support recovery). Without Redis it runs single-instance.
 */
export const createSocketServer = async ({ httpServer, sessionMiddleware }: CreateSocketServerOptions): Promise<AppServer> => {
  const io: AppServer = new Server(httpServer, {
    cors: { origin: env.CORS_ALLOW_ALL ? true : env.CLIENT_ORIGIN, credentials: true },
    // A client that drops for < 2 min gets its rooms back and the events it missed.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: false },
    pingInterval: 20_000, // detect dead connections (closed laptop, lost wifi) within ~40s
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024, // messages are text ≤ 4000 chars; refuse huge frames
  });

  if (isRedisReady()) {
    const adapterClient = createRedisConnection('socket-adapter');
    await adapterClient.connect();
    io.adapter(createAdapter(adapterClient, { maxLen: 10_000 }));
    logger.info('Socket.IO Redis Streams adapter enabled');
  } else {
    logger.warn('Redis unavailable; Socket.IO running single-instance (no cross-server events)');
  }

  io.engine.use(sessionMiddleware);
  attachSocketAuth(io);

  io.engine.on('connection_error', (error: { code: number; message: string }) => {
    logger.warn({ code: error.code, message: error.message }, 'Socket.IO connection error');
  });

  return io;
};

/** Joins the personal/staff rooms, then hands the socket to every gateway in order. */
export const registerGateways = (io: AppServer, gateways: Gateway[]) => {
  io.on('connection', (socket) => {
    const { user } = socket.data;
    logger.info({ socketId: socket.id, userId: user.id, recovered: socket.recovered }, 'Socket connected');

    // Not awaited on purpose: gateways must attach their handlers in this same tick.
    const baseRooms = isStaff(user.role) ? [rooms.user(user.id), rooms.staff] : [rooms.user(user.id)];
    void Promise.resolve(socket.join(baseRooms)).catch((error) =>
      logger.error({ error, socketId: socket.id }, 'Failed to join base rooms'),
    );

    socket.on('disconnect', (reason) => logger.info({ socketId: socket.id, userId: user.id, reason }, 'Socket disconnected'));
    socket.on('error', (error) => logger.error({ socketId: socket.id, userId: user.id, error }, 'Socket error'));

    for (const gateway of gateways) {
      try {
        gateway.onConnection(socket);
      } catch (error) {
        logger.error({ error, socketId: socket.id, gateway: gateway.constructor.name }, 'Gateway connection handler failed');
      }
    }
  });
};
