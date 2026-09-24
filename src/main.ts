import http from 'node:http';
import { createApp } from './app.js';
import { env } from './core/config/env.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from './core/database/mongo.js';
import { logger } from './core/logger.js';
import { connectRedis, disconnectRedis } from './core/redis/redis.js';
import { createSessionManager } from './core/session/session.js';
import { createAgentsModule } from './modules/agents/agents.module.js';
import { createAuthModule } from './modules/auth/auth.module.js';
import { createChatModule } from './modules/chat/chat.module.js';
import { createMetricsModule } from './modules/metrics/metrics.module.js';
import { createPresenceModule } from './modules/presence/presence.module.js';
import { createPushModule } from './modules/push/push.module.js';
import { createUsersModule } from './modules/users/users.module.js';
import { createSocketServer, registerGateways } from './realtime/socket.server.js';

import mongooseDebug from 'mongoose';
if (process.env.MONGOOSE_DEBUG) mongooseDebug.set('debug', (c: string, m: string, ...a: unknown[]) => { if (c === 'agentprofiles') console.error('DBG', c, m, JSON.stringify(a).slice(0, 260)); });
const bootstrap = async () => {
  // 1. Infrastructure
  await connectDatabase();
  await connectRedis();
  const sessionManager = await createSessionManager();

  // 2. Modules (services + routers), like NestJS's module tree
  const auth = createAuthModule();
  const users = createUsersModule();
  const chat = createChatModule({ usersService: users.usersService });
  const presence = createPresenceModule();
  const agents = createAgentsModule({
    usersService: users.usersService,
    conversationsService: chat.conversationsService,
    presenceService: presence.presenceService,
  });
  const metrics = createMetricsModule({
    presenceService: presence.presenceService,
    agentsService: agents.agentsService,
    conversationsService: chat.conversationsService,
  });
  const push = createPushModule({
    conversationsService: chat.conversationsService,
    metricsService: metrics.metricsService,
  });

  // Unique indexes must exist before the first request (see ensureIndexes).
  await ensureIndexes();

  // 3. HTTP
  const app = createApp(sessionManager.middleware, {
    auth: auth.router,
    users: users.router,
    chat: chat.router,
    agents: agents.router,
    push: push.router,
    metrics: metrics.router,
    prometheus: metrics.prometheusHandler,
  });
  const httpServer = http.createServer(app);

  // 4. Realtime
  const io = await createSocketServer({ httpServer, sessionMiddleware: sessionManager.middleware });
  const chatGateway = chat.createGateway(io);
  registerGateways(io, [presence.gateway, chatGateway, agents.gateway, metrics.gateway]);
  presence.presenceService.start(io);
  agents.start(io, chatGateway);
  metrics.metricsService.start(io);
  chatGateway.onMessageCreated(() => metrics.metricsService.recordMessage());
  push.start(io, chatGateway);

  httpServer.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Chat backend started'));

  // 5. Graceful shutdown: stop taking work, then close connections in reverse order.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    agents.stop();
    metrics.metricsService.stop();
    await push.stop();
    await presence.presenceService.stop();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await sessionManager.disconnect();
    await disconnectRedis();
    await disconnectDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start chat backend');
  process.exit(1);
});
