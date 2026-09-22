import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(pinoHttp({ logger }));

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    logger.error({ error }, 'Unhandled HTTP error');
    if (response.headersSent) return next(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
};
