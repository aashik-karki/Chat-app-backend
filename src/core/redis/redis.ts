import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

/**
 * One place that creates ioredis connections. Use:
 *  - `redis`            → normal commands (cache, presence, metrics)
 *  - `createRedisConnection()` → extra connections that need their own socket
 *    (Socket.IO adapter pub/sub, BullMQ workers).
 */
const baseOptions: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: null, // required by BullMQ
  connectTimeout: 2_000,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

const connections: Redis[] = [];

export const createRedisConnection = (name = 'redis'): Redis => {
  const client = new Redis(env.REDIS_URL, baseOptions);
  client.on('error', (error) => logger.warn({ error, name }, 'Redis connection error'));
  connections.push(client);
  return client;
};

export const redis = createRedisConnection('main');

let redisReady = false;
export const isRedisReady = (): boolean => redisReady && redis.status === 'ready';

export const connectRedis = async (): Promise<boolean> => {
  try {
    await redis.connect();
    redisReady = true;
    logger.info('Redis connected');
    return true;
  } catch (error) {
    if (!env.ALLOW_INFRA_FAILURE) throw error;
    logger.warn({ error }, 'Redis unavailable; caching and multi-server features disabled');
    return false;
  }
};

export const disconnectRedis = async (): Promise<void> => {
  await Promise.allSettled(connections.map((client) => (client.status === 'ready' ? client.quit() : client.disconnect())));
};