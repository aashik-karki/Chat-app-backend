import type { Redis } from 'ioredis';

export interface PresenceSnapshot {
  online: boolean;
  lastSeen: string | null;
}

/**
 * Where "who is online" lives. Online = at least one live socket.
 * The Redis version is shared by every server instance; the memory version
 * is only for local development without Redis.
 */
export interface PresenceStore {
  /** Registers a socket. Returns true if the user just came online. */
  addSocket(userId: string, socketId: string): Promise<boolean>;
  removeSocket(userId: string, socketId: string): Promise<void>;
  /** If the user has no live sockets left, marks them offline. Returns true if they just went offline. */
  settle(userId: string): Promise<boolean>;
  /** Heartbeat: extends the lease of sockets that are still connected to this server. */
  refresh(entries: Array<{ userId: string; socketId: string }>): Promise<void>;
  /** Finds users whose sockets all expired (e.g. a server crashed) and marks them offline. */
  sweep(): Promise<string[]>;
  snapshot(userIds: string[]): Promise<Record<string, PresenceSnapshot>>;
  countOnline(): Promise<number>;
}

/** A socket's lease; renewed by heartbeat. If its server dies, it expires on its own. */
export const SOCKET_LEASE_MS = 90_000;

const KEYS = {
  sockets: (userId: string) => `presence:sockets:${userId}`, // ZSET socketId → lease expiry (ms)
  online: 'presence:online', // SET of online userIds
  lastSeen: 'presence:last-seen', // HASH userId → ISO time
  sweepLock: 'presence:sweep-lock',
};

// Both scripts run atomically inside Redis, so two servers can never
// disagree about whether a user is online (no check-then-act race).
const ADD_SOCKET = `
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return redis.call('SADD', KEYS[2], ARGV[3])`;

const SETTLE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end
local removed = redis.call('SREM', KEYS[2], ARGV[2])
if removed == 1 then redis.call('HSET', KEYS[3], ARGV[2], ARGV[3]) end
return removed`;

export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: Redis) {}

  async addSocket(userId: string, socketId: string) {
    const expiry = Date.now() + SOCKET_LEASE_MS;
    const added = await this.redis.eval(ADD_SOCKET, 2, KEYS.sockets(userId), KEYS.online, socketId, expiry, userId, SOCKET_LEASE_MS * 2);
    return added === 1;
  }

  async removeSocket(userId: string, socketId: string) {
    await this.redis.zrem(KEYS.sockets(userId), socketId);
  }

  async settle(userId: string) {
    const removed = await this.redis.eval(SETTLE, 3, KEYS.sockets(userId), KEYS.online, KEYS.lastSeen, Date.now(), userId, new Date().toISOString());
    return removed === 1;
  }

  async refresh(entries: Array<{ userId: string; socketId: string }>) {
    if (entries.length === 0) return;
    const expiry = Date.now() + SOCKET_LEASE_MS;
    const pipeline = this.redis.pipeline();
    for (const { userId, socketId } of entries) {
      pipeline.zadd(KEYS.sockets(userId), 'XX', expiry, socketId); // XX: only renew, never re-add a removed socket
      pipeline.pexpire(KEYS.sockets(userId), SOCKET_LEASE_MS * 2);
    }
    await pipeline.exec();
  }

  async sweep() {
    // Only one server sweeps per interval.
    const gotLock = await this.redis.set(KEYS.sweepLock, '1', 'PX', 25_000, 'NX');
    if (!gotLock) return [];

    const wentOffline: string[] = [];
    let cursor = '0';
    do {
      const [next, userIds] = await this.redis.sscan(KEYS.online, cursor, 'COUNT', 500);
      cursor = next;
      for (const userId of userIds) {
        if (await this.settle(userId)) wentOffline.push(userId);
      }
    } while (cursor !== '0');
    return wentOffline;
  }

  async snapshot(userIds: string[]) {
    if (userIds.length === 0) return {};
    const [onlineFlags, lastSeen] = await Promise.all([
      this.redis.smismember(KEYS.online, ...userIds),
      this.redis.hmget(KEYS.lastSeen, ...userIds),
    ]);
    return Object.fromEntries(
      userIds.map((id, i) => [id, { online: onlineFlags[i] === 1, lastSeen: onlineFlags[i] === 1 ? null : (lastSeen[i] ?? null) }]),
    );
  }

  countOnline() {
    return this.redis.scard(KEYS.online);
  }
}

/** Single-process fallback when Redis is not running (development only). */
export class MemoryPresenceStore implements PresenceStore {
  private sockets = new Map<string, Set<string>>();
  private lastSeen = new Map<string, string>();

  async addSocket(userId: string, socketId: string) {
    const set = this.sockets.get(userId) ?? new Set<string>();
    const cameOnline = set.size === 0;
    set.add(socketId);
    this.sockets.set(userId, set);
    return cameOnline;
  }

  async removeSocket(userId: string, socketId: string) {
    this.sockets.get(userId)?.delete(socketId);
  }

  async settle(userId: string) {
    const set = this.sockets.get(userId);
    if (!set || set.size > 0) return false;
    this.sockets.delete(userId);
    this.lastSeen.set(userId, new Date().toISOString());
    return true;
  }

  async refresh() {}

  async sweep() {
    return [];
  }

  async snapshot(userIds: string[]) {
    return Object.fromEntries(
      userIds.map((id) => {
        const online = (this.sockets.get(id)?.size ?? 0) > 0;
        return [id, { online, lastSeen: online ? null : (this.lastSeen.get(id) ?? null) }];
      }),
    );
  }

  async countOnline() {
    return [...this.sockets.values()].filter((set) => set.size > 0).length;
  }
}
