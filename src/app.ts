import cors from 'cors';
import express, { type RequestHandler, type Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler, notFoundHandler } from './common/errors/error-handler.js';
import { buildOpenApiDocument } from './docs/openapi.js';
import { env } from './core/config/env.js';
import { isDatabaseReady } from './core/database/mongo.js';
import { logger } from './core/logger.js';
import { isRedisReady } from './core/redis/redis.js';

export interface AppRouters {
  auth: Router;
  users: Router;
  chat: Router;
  agents: Router;
  push: Router;
  metrics: Router;
  /** GET /metrics (Prometheus text format) */
  prometheus: RequestHandler;
}

/** Like NestJS's AppModule: global middleware + every module's routes under /api/v1. */
export const createApp = (sessionMiddleware: RequestHandler, routers: AppRouters) => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ALLOW_ALL ? true : env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (request) => request.url?.startsWith('/health') ?? false } }));

  // Health checks (no session needed): liveness for the process, readiness for dependencies.
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/health/ready', (_request, response) => {
    const checks = { mongo: isDatabaseReady(), redis: isRedisReady() };
    response.status(checks.mongo ? 200 : 503).json({ status: checks.mongo ? 'ready' : 'not_ready', checks });
  });

  // API docs: Swagger UI + raw OpenAPI JSON (generated from the zod DTOs).
  const openApiDocument = buildOpenApiDocument();
  app.get('/api/docs/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'Support Chat API' }));

  app.get('/metrics', routers.prometheus);

  app.use(sessionMiddleware);

  const api = express.Router();
  api.use('/auth', routers.auth);
  api.use('/admin/users', routers.users);
  api.use('/conversations', routers.chat);
  api.use('/agents', routers.agents);
  api.use('/push', routers.push);
  api.use('/metrics', routers.metrics);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
