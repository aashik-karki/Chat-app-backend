import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { HttpError } from './lib/http-error.js';
import { logger } from './lib/logger.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { authRouter } from './routes/auth.js';

export const createApp = (sessionMiddleware: RequestHandler) => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ALLOW_ALL ? true : env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(pinoHttp({ logger }));
  app.use(sessionMiddleware);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/admin/users', adminUsersRouter);

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    logger.error({ error }, 'Unhandled HTTP error');
    if (response.headersSent) return next(error);
    if (error instanceof HttpError) {
      return response.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
};
