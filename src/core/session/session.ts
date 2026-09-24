import { RedisStore } from 'connect-redis';
import type { RequestHandler } from 'express';
import session, { type CookieOptions } from 'express-session';
import { createClient, type RedisClientType } from 'redis';
import { env, isProduction } from '../config/env.js';
import { logger } from '../logger.js';

export const SESSION_COOKIE_NAME = 'chat.sid';

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true, // JS in the browser can't read the cookie
  secure: isProduction, // HTTPS only in production
  sameSite: 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
};

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
      name: SESSION_COOKIE_NAME,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // active users stay logged in; idle ones expire after maxAge
      store,
      cookie: sessionCookieOptions,
    }),
    disconnect: async () => {
      if (client?.isOpen) await client.quit();
    },
  };
};
