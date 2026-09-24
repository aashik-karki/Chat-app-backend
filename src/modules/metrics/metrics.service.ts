import type { Redis } from 'ioredis';
import { logger } from '../../core/logger.js';
import { rooms } from '../../realtime/rooms.js';
import type { AppServer } from '../../realtime/socket.types.js';
import type { AgentsService } from '../agents/services/agents.service.js';
import type { ConversationsService } from '../chat/services/conversations.service.js';
import type { PresenceService } from '../presence/presence.service.js';

export type PushOutcome = 'sent' | 'failed' | 'expired';

export interface MetricsSnapshot {
  timestamp: string;
  activeUsers: number;
  agents: { online: number; busy: number; offline: number };
  conversations: { open: number; waitingInQueue: number };
  messages: { lastMinute: number; lastHour: number; today: number };
  push: Record<PushOutcome, number>;
  /** Socket connections on the server that produced this snapshot. */
  connectionsOnThisServer: number;
}

export interface SeriesPoint {
  minute: string;
  messages: number;
}

export interface MetricsUpdate {
  snapshot: MetricsSnapshot;
  /** The last 60 minutes, oldest first. */
  messagesPerMinute: SeriesPoint[];
}

const BROADCAST_EVERY_MS = 5_000;
const MINUTE_TTL_SECONDS = 26 * 60 * 60; // keep 26h of per-minute points
const DAY_TTL_SECONDS = 8 * 24 * 60 * 60; // keep 8 days of daily totals

const minuteKey = (date: Date) => date.toISOString().slice(0, 16); // 2026-09-24T06:05
const dayKey = (date: Date) => date.toISOString().slice(0, 10); // 2026-09-24

/**
 * Counters are stored in Redis as a tiny time series: one key per minute /
 * per day (INCR + TTL). Every server writes to the same keys, so the numbers
 * are cluster-wide. Without Redis, an in-memory map is used (single server).
 */
interface CounterStore {
  incr(key: string, ttlSeconds: number): Promise<void>;
  getMany(keys: string[]): Promise<number[]>;
  tryLock(key: string, ms: number): Promise<boolean>;
}

class RedisCounters implements CounterStore {
  constructor(private readonly redis: Redis) {}
  async incr(key: string, ttlSeconds: number) {
    await this.redis.multi().incr(key).expire(key, ttlSeconds).exec();
  }
  async getMany(keys: string[]) {
    if (keys.length === 0) return [];
    return (await this.redis.mget(...keys)).map((value) => Number(value ?? 0));
  }
  async tryLock(key: string, ms: number) {
    return (await this.redis.set(key, '1', 'PX', ms, 'NX')) === 'OK';
  }
}

class MemoryCounters implements CounterStore {
  private values = new Map<string, number>();
  async incr(key: string) {
    this.values.set(key, (this.values.get(key) ?? 0) + 1);
  }
  async getMany(keys: string[]) {
    return keys.map((key) => this.values.get(key) ?? 0);
  }
  async tryLock() {
    return true;
  }
}

export class MetricsService {
  private io: AppServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly counters: CounterStore;

  constructor(
    redis: Redis | null,
    private readonly presence: PresenceService,
    private readonly agents: AgentsService,
    private readonly conversations: ConversationsService,
  ) {
    this.counters = redis ? new RedisCounters(redis) : new MemoryCounters();
  }

  /** Pushes live metrics to subscribed dashboards every 5s (one server does it, via a Redis lock). */
  start(io: AppServer) {
    this.io = io;
    this.timer = setInterval(() => void this.broadcast(), BROADCAST_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Never throws: metrics must not break sending a message. */
  recordMessage(): void {
    const now = new Date();
    void Promise.all([
      this.counters.incr(`metrics:messages:m:${minuteKey(now)}`, MINUTE_TTL_SECONDS),
      this.counters.incr(`metrics:messages:d:${dayKey(now)}`, DAY_TTL_SECONDS),
    ]).catch((error) => logger.warn({ error }, 'recordMessage failed'));
  }

  recordPush(outcome: PushOutcome): void {
    void this.counters
      .incr(`metrics:push:${outcome}:d:${dayKey(new Date())}`, DAY_TTL_SECONDS)
      .catch((error) => logger.warn({ error }, 'recordPush failed'));
  }

  async messagesPerMinute(minutes = 60): Promise<SeriesPoint[]> {
    const now = Date.now();
    const labels = Array.from({ length: minutes }, (_, i) => minuteKey(new Date(now - (minutes - 1 - i) * 60_000)));
    const values = await this.counters.getMany(labels.map((label) => `metrics:messages:m:${label}`));
    return labels.map((minute, i) => ({ minute, messages: values[i] ?? 0 }));
  }

  async snapshot(): Promise<MetricsSnapshot> {
    const today = dayKey(new Date());
    const [activeUsers, agentStatuses, open, waiting, series, dayCounts] = await Promise.all([
      this.presence.countOnline(),
      this.agents.listStatuses(),
      this.conversations.countOpen(),
      this.conversations.countQueue(),
      this.messagesPerMinute(60),
      this.counters.getMany([
        `metrics:messages:d:${today}`,
        `metrics:push:sent:d:${today}`,
        `metrics:push:failed:d:${today}`,
        `metrics:push:expired:d:${today}`,
      ]),
    ]);
    const [messagesToday = 0, pushSent = 0, pushFailed = 0, pushExpired = 0] = dayCounts;

    return {
      timestamp: new Date().toISOString(),
      activeUsers,
      agents: {
        online: agentStatuses.filter((agent) => agent.status === 'online').length,
        busy: agentStatuses.filter((agent) => agent.status === 'busy').length,
        offline: agentStatuses.filter((agent) => agent.status === 'offline').length,
      },
      conversations: { open, waitingInQueue: waiting },
      messages: {
        lastMinute: series[series.length - 1]?.messages ?? 0,
        lastHour: series.reduce((sum, point) => sum + point.messages, 0),
        today: messagesToday,
      },
      push: { sent: pushSent, failed: pushFailed, expired: pushExpired },
      connectionsOnThisServer: this.io?.engine.clientsCount ?? 0,
    };
  }

  async update(): Promise<MetricsUpdate> {
    const [snapshot, messagesPerMinute] = await Promise.all([this.snapshot(), this.messagesPerMinute(60)]);
    return { snapshot, messagesPerMinute };
  }

  /** Prometheus text format, for Grafana/Prometheus scraping (GET /metrics). */
  async prometheus(): Promise<string> {
    const s = await this.snapshot();
    const lines = [
      '# HELP chat_active_users Users with at least one live socket',
      '# TYPE chat_active_users gauge',
      `chat_active_users ${s.activeUsers}`,
      '# HELP chat_agents Agents by status',
      '# TYPE chat_agents gauge',
      ...Object.entries(s.agents).map(([status, count]) => `chat_agents{status="${status}"} ${count}`),
      '# HELP chat_conversations Conversations by state',
      '# TYPE chat_conversations gauge',
      `chat_conversations{state="open"} ${s.conversations.open}`,
      `chat_conversations{state="queued"} ${s.conversations.waitingInQueue}`,
      '# HELP chat_messages_today Messages sent today (UTC)',
      '# TYPE chat_messages_today gauge',
      `chat_messages_today ${s.messages.today}`,
      '# HELP chat_messages_last_minute Messages sent in the current minute',
      '# TYPE chat_messages_last_minute gauge',
      `chat_messages_last_minute ${s.messages.lastMinute}`,
      '# HELP chat_push_today Push notification outcomes today (UTC)',
      '# TYPE chat_push_today gauge',
      ...Object.entries(s.push).map(([outcome, count]) => `chat_push_today{outcome="${outcome}"} ${count}`),
      '# HELP chat_socket_connections Socket connections on this instance',
      '# TYPE chat_socket_connections gauge',
      `chat_socket_connections ${s.connectionsOnThisServer}`,
    ];
    return `${lines.join('\n')}\n`;
  }

  private async broadcast() {
    if (!this.io) return;
    try {
      if (!(await this.counters.tryLock('metrics:broadcast-lock', BROADCAST_EVERY_MS - 500))) return;
      this.io.to(rooms.metrics).emit('metrics:update', await this.update());
    } catch (error) {
      logger.warn({ error }, 'Metrics broadcast failed');
    }
  }
}
