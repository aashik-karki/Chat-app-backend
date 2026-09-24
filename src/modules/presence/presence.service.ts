import { logger } from '../../core/logger.js';
import { rooms } from '../../realtime/rooms.js';
import type { AppServer } from '../../realtime/socket.types.js';
import type { PresenceSnapshot, PresenceStore } from './presence.store.js';

/** A page reload drops the socket for ~1s; don't flash "offline" for that. */
const OFFLINE_GRACE_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const SWEEP_MS = 30_000;

type PresenceListener = (event: { userId: string; online: boolean }) => void;

/**
 * Online/offline tracking that stays correct when:
 *  - a user has several tabs/devices (online until the LAST one closes)
 *  - a user reloads the page (5s grace, no offline flicker)
 *  - the network drops without a clean close (Socket.IO ping timeout → disconnect)
 *  - a whole server crashes (its sockets' leases expire; another server's sweep marks them offline)
 *  - there are many servers (state lives in Redis, updates go through the adapter)
 */
export class PresenceService {
  private io: AppServer | null = null;
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private intervals: NodeJS.Timeout[] = [];
  private listeners: PresenceListener[] = [];

  constructor(private readonly store: PresenceStore) {}

  /** Other modules (agents, metrics) can react to presence changes. */
  onChange(listener: PresenceListener) {
    this.listeners.push(listener);
  }

  start(io: AppServer) {
    this.io = io;
    this.intervals.push(
      setInterval(() => void this.heartbeat(), HEARTBEAT_MS),
      setInterval(() => void this.sweep(), SWEEP_MS),
    );
  }

  /** On shutdown: settle pending offline checks now instead of leaving users "online". */
  async stop() {
    this.intervals.forEach(clearInterval);
    const pending = [...this.graceTimers.keys()];
    this.graceTimers.forEach(clearTimeout);
    this.graceTimers.clear();
    await Promise.allSettled(pending.map((userId) => this.settle(userId)));
  }

  async socketConnected(userId: string, socketId: string) {
    const timer = this.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(userId);
    }
    const cameOnline = await this.store.addSocket(userId, socketId);
    if (cameOnline) this.publish(userId, { online: true, lastSeen: null });
  }

  async socketDisconnected(userId: string, socketId: string) {
    await this.store.removeSocket(userId, socketId);
    const existing = this.graceTimers.get(userId);
    if (existing) clearTimeout(existing);
    this.graceTimers.set(
      userId,
      setTimeout(() => {
        this.graceTimers.delete(userId);
        void this.settle(userId);
      }, OFFLINE_GRACE_MS),
    );
  }

  snapshot(userIds: string[]): Promise<Record<string, PresenceSnapshot>> {
    return this.store.snapshot(userIds);
  }

  countOnline(): Promise<number> {
    return this.store.countOnline();
  }

  private async settle(userId: string) {
    try {
      if (await this.store.settle(userId)) {
        const [state] = Object.values(await this.store.snapshot([userId]));
        this.publish(userId, state ?? { online: false, lastSeen: new Date().toISOString() });
      }
    } catch (error) {
      logger.warn({ error, userId }, 'Presence settle failed');
    }
  }

  private async heartbeat() {
    if (!this.io) return;
    try {
      const entries = [...this.io.of('/').sockets.values()].map((socket) => ({ userId: socket.data.user.id, socketId: socket.id }));
      await this.store.refresh(entries);
    } catch (error) {
      logger.warn({ error }, 'Presence heartbeat failed');
    }
  }

  private async sweep() {
    try {
      const wentOffline = await this.store.sweep();
      for (const userId of wentOffline) {
        const [state] = Object.values(await this.store.snapshot([userId]));
        this.publish(userId, state ?? { online: false, lastSeen: null });
      }
    } catch (error) {
      logger.warn({ error }, 'Presence sweep failed');
    }
  }

  /** Goes to everyone watching this user + every staff dashboard, on every server. */
  private publish(userId: string, state: PresenceSnapshot) {
    this.io?.to([rooms.presence(userId), rooms.staff]).emit('presence:update', { userId, ...state });
    for (const listener of this.listeners) {
      try {
        listener({ userId, online: state.online });
      } catch (error) {
        logger.warn({ error }, 'Presence listener failed');
      }
    }
  }
}
