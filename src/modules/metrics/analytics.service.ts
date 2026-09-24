import type { Redis } from 'ioredis';
import { logger } from '../../core/logger.js';
import { Conversation } from '../chat/models/conversation.model.js';
import { Message } from '../chat/models/message.model.js';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

export interface DailyPoint {
  /** Calendar day in the requested time zone, YYYY-MM-DD. */
  date: string;
  messages: number;
  /** The same day one period earlier. */
  previous: number;
}

export interface Analytics {
  range: { days: number; timeZone: string; from: string; to: string };
  messages: { total: number; previousTotal: number; daily: DailyPoint[] };
  /** Messages per weekday in the period, Sunday first. */
  byWeekday: number[];
  conversations: { closed: number; previousClosed: number };
  generatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_SECONDS = 60;

/**
 * Historical numbers for the admin dashboard, computed from MongoDB (the source
 * of truth — Redis counters only keep 8 days). Cached in Redis for 60s per
 * (days, time zone), so a dashboard left open doesn't re-run the aggregation.
 */
export class AnalyticsService {
  constructor(private readonly redis: Redis | null) {}

  async get(query: AnalyticsQueryDto): Promise<Analytics> {
    const key = `metrics:analytics:v1:${query.days}:${query.tz}`;
    const cached = await this.redis?.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as Analytics;

    const result = await this.compute(query);
    await this.redis?.set(key, JSON.stringify(result), 'EX', CACHE_SECONDS).catch((error: unknown) => logger.warn({ error }, 'analytics cache write failed'));
    return result;
  }

  /**
   * Messages per calendar day since `since`. Reads ONLY `createdAt` through the
   * { createdAt: -1 } index (a covered query: no documents are loaded) and
   * buckets in code, so any time zone works, including +05:45. Timestamps are
   * grouped into 15-minute slots first, so the date formatter runs once per slot,
   * not once per message.
   */
  private async countMessagesPerDay(since: Date, dayOf: Intl.DateTimeFormat) {
    const SLOT_MS = 15 * 60 * 1000;
    const perSlot = new Map<number, number>();
    const cursor = Message.find({ createdAt: { $gte: since } }, { createdAt: 1, _id: 0 }).lean().cursor({ batchSize: 5000 });
    for await (const { createdAt } of cursor) {
      const slot = Math.floor(createdAt.getTime() / SLOT_MS);
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
    }
    const perDay = new Map<string, number>();
    for (const [slot, count] of perSlot) {
      const day = dayOf.format(new Date(slot * SLOT_MS));
      perDay.set(day, (perDay.get(day) ?? 0) + count);
    }
    return perDay;
  }

  private async compute({ days, tz }: AnalyticsQueryDto): Promise<Analytics> {
    const now = new Date();
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    // Oldest → newest calendar days: the previous period, then the current one.
    const labels = Array.from({ length: days * 2 }, (_, i) => dayOf.format(new Date(now.getTime() - (days * 2 - 1 - i) * DAY_MS)));
    // One spare day on each side of the window covers time zone offsets; days outside `labels` are ignored.
    const since = new Date(now.getTime() - (days * 2 + 1) * DAY_MS);
    const periodStart = new Date(now.getTime() - days * DAY_MS);

    const [counts, closed, previousClosed] = await Promise.all([
      this.countMessagesPerDay(since, dayOf),
      Conversation.countDocuments({ status: 'closed', updatedAt: { $gte: periodStart } }),
      Conversation.countDocuments({ status: 'closed', updatedAt: { $gte: new Date(periodStart.getTime() - days * DAY_MS), $lt: periodStart } }),
    ]);

    const previousLabels = labels.slice(0, days);
    const currentLabels = labels.slice(days);
    const daily = currentLabels.map((date, i) => ({ date, messages: counts.get(date) ?? 0, previous: counts.get(previousLabels[i] ?? '') ?? 0 }));

    const byWeekday = [0, 0, 0, 0, 0, 0, 0];
    for (const point of daily) byWeekday[new Date(`${point.date}T12:00:00Z`).getUTCDay()]! += point.messages;

    return {
      range: { days, timeZone: tz, from: currentLabels[0]!, to: currentLabels[currentLabels.length - 1]! },
      messages: {
        total: daily.reduce((sum, point) => sum + point.messages, 0),
        previousTotal: daily.reduce((sum, point) => sum + point.previous, 0),
        daily,
      },
      byWeekday,
      conversations: { closed, previousClosed },
      generatedAt: now.toISOString(),
    };
  }
}
