import type { Redis } from 'ioredis';
import { logger } from '../../../core/logger.js';
import type { MessageResponse } from '../chat.mapper.js';

export interface CachedHistoryPage {
  messages: MessageResponse[];
  nextCursor: string | null;
}

const PAGE_TTL_SECONDS = 5 * 60; // hot threads stay cached; idle ones expire on their own
const VERSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Cache-aside cache for the FIRST page of a conversation's history — the page
 * every client loads when it opens a chat, so it is the "hot" data.
 *
 * Invalidation uses a version number per conversation instead of deleting keys:
 *   chat:history:{conversationId}:ver          → integer, INCR on every write
 *   chat:history:{conversationId}:v{n}:{limit} → cached JSON page
 *
 * A write (new message, delivered, read) bumps the version, so every older
 * cached page is simply never read again (and expires by TTL). This also
 * avoids the classic cache-aside race where a slow reader writes a stale
 * page back into the cache *after* a writer deleted it: the stale page is
 * stored under the old version number, which nobody asks for anymore.
 *
 * Every method fails open: if Redis is down, callers just go to MongoDB.
 */
export class MessageCacheService {
  constructor(
    private readonly redis: Redis,
    private readonly isReady: () => boolean,
  ) {}

  private versionKey(conversationId: string) {
    return `chat:history:${conversationId}:ver`;
  }

  private pageKey(conversationId: string, version: string, limit: number) {
    return `chat:history:${conversationId}:v${version}:${limit}`;
  }

  /** Returns the cached page, or a `store` function to fill the cache after a miss. */
  async getFirstPage(
    conversationId: string,
    limit: number,
  ): Promise<{ hit: CachedHistoryPage } | { hit: null; store: (page: CachedHistoryPage) => Promise<void> }> {
    const noop = { hit: null, store: async () => undefined };
    if (!this.isReady()) return noop;

    try {
      const version = (await this.redis.get(this.versionKey(conversationId))) ?? '0';
      const key = this.pageKey(conversationId, version, limit);
      const cached = await this.redis.get(key);
      if (cached) return { hit: JSON.parse(cached) as CachedHistoryPage };

      return {
        hit: null,
        store: async (page) => {
          try {
            await this.redis.set(key, JSON.stringify(page), 'EX', PAGE_TTL_SECONDS);
          } catch (error) {
            logger.warn({ error, conversationId }, 'History cache write failed');
          }
        },
      };
    } catch (error) {
      logger.warn({ error, conversationId }, 'History cache read failed');
      return noop;
    }
  }

  /** Call after ANY change to a conversation's messages. */
  async invalidate(conversationId: string): Promise<void> {
    if (!this.isReady()) return;
    try {
      await this.redis.multi().incr(this.versionKey(conversationId)).expire(this.versionKey(conversationId), VERSION_TTL_SECONDS).exec();
    } catch (error) {
      logger.warn({ error, conversationId }, 'History cache invalidation failed');
    }
  }
}
