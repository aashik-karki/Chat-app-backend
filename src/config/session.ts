import { RedisStore } from 'connect-redis';
import type { RequestHandler } from 'express';
import session from 'express-session';
import { createClient, type RedisClientType } from 'redis';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

export interface SessionManager {
  middleware: RequestHandler;
  disconnect: () => Promise<void>;
}

export const createSessionManager = async (): Promise<SessionManager> => {
  let store: session.Store | undefined;
  let client: RedisClientType | undefined;

  try {
    client = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => (retries === 0 ? 100 : false),
      },
    });
    client.on('error', (error) => logger.warn({ error }, 'Session Redis client error'));
    await client.connect();
    store = new RedisStore({ client, prefix: 'chat-backend:session:' });
    logger.info('Redis session store enabled');
  } catch (error) {
    if (!env.ALLOW_INFRA_FAILURE) throw error;
    logger.warn({ error }, 'Redis unavailable; using in-memory sessions for development only');
    if (client?.isOpen) await client.disconnect();
  }

  return {
    middleware: session({
      name: 'chat.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
    disconnect: async () => {
      if (client?.isOpen) await client.quit();
    },
  };
};
