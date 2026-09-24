import { isRedisReady, redis } from '../../core/redis/redis.js';
import { PresenceGateway } from './presence.gateway.js';
import { PresenceService } from './presence.service.js';
import { MemoryPresenceStore, RedisPresenceStore } from './presence.store.js';

/** Call AFTER connectRedis(), so it can pick the shared Redis store. */
export const createPresenceModule = () => {
  const store = isRedisReady() ? new RedisPresenceStore(redis) : new MemoryPresenceStore();
  const presenceService = new PresenceService(store);
  return {
    presenceService,
    gateway: new PresenceGateway(presenceService),
  };
};
