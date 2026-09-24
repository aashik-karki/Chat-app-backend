import { Types } from 'mongoose';
import { HttpError } from '../../../common/errors/http-error.js';
import { isDuplicateKeyError } from '../../../common/utils/mongo-errors.js';
import { decodeCursor, encodeCursor } from '../../../common/utils/pagination.js';
import { toMessageResponse, type MessageResponse } from '../chat.mapper.js';
import { Message } from '../models/message.model.js';
import type { LeanMessage } from '../models/message.types.js';
import type { ConversationsService } from './conversations.service.js';
import type { MessageCacheService } from './message-cache.service.js';

export interface HistoryPage {
  messages: MessageResponse[];
  nextCursor: string | null;
}

export interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  text: string;
}

export interface ReadResult {
  readAt: string;
  /** How many messages actually changed. 0 = nothing to broadcast. */
  updatedCount: number;
}

export class MessagesService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly cache: MessageCacheService,
  ) {}

  /**
   * Keyset-paginated history, returned oldest → newest for rendering.
   * The first page (no cursor) is served from Redis when possible.
   */
  async getHistory(conversationId: string, { cursor, limit }: { cursor?: string; limit: number }): Promise<HistoryPage> {
    const query: Record<string, unknown> = { conversationId };

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) throw HttpError.badRequest('INVALID_CURSOR', 'Invalid pagination cursor');
      query.$or = [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: new Types.ObjectId(decoded.id) } },
      ];
    } else {
      const cached = await this.cache.getFirstPage(conversationId, limit);
      if (cached.hit) return cached.hit;
      const page = await this.loadPage(query, limit);
      await cached.store(page);
      return page;
    }

    return this.loadPage(query, limit);
  }

  private async loadPage(query: Record<string, unknown>, limit: number): Promise<HistoryPage> {
    const rows = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean<LeanMessage[]>();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page[page.length - 1];
    return {
      messages: page.map(toMessageResponse).reverse(),
      nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest._id.toString()) : null,
    };
  }

  /**
   * Saves a message. Idempotent on (conversationId, clientMessageId): a retry
   * after a lost ack returns the already-saved message instead of a duplicate.
   * `created` tells the caller whether to broadcast it.
   */
  async create(input: CreateMessageInput): Promise<{ message: MessageResponse; created: boolean }> {
    try {
      const doc = await Message.create(input);
      await this.conversations.touchLastMessage(input.conversationId, input.text, doc.createdAt);
      await this.cache.invalidate(input.conversationId);
      return { message: toMessageResponse(doc.toObject() as LeanMessage), created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await Message.findOne({
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
      }).lean<LeanMessage>();
      if (!existing) throw error;
      return { message: toMessageResponse(existing), created: false };
    }
  }

  /** One message → delivered, only if it is still `sent` (never downgrades a `read`). */
  async markDelivered(messageId: string): Promise<MessageResponse | null> {
    const message = await Message.findOneAndUpdate(
      { _id: messageId, status: 'sent' },
      { $set: { status: 'delivered', deliveredAt: new Date() } },
      { new: true },
    ).lean<LeanMessage>();
    if (message) await this.cache.invalidate(message.conversationId.toString());
    return message ? toMessageResponse(message) : null;
  }

  /**
   * Everything the other side sent that `recipientId` hasn't received yet →
   * delivered. The `status: 'sent'` condition is inside the update itself, so
   * a message that became `read` in between is never pushed back to
   * `delivered`. Returns exactly the messages this call changed.
   */
  async markDeliveredForRecipient(conversationId: string, recipientId: string): Promise<MessageResponse[]> {
    const filter = { conversationId, senderId: { $ne: recipientId }, status: 'sent' as const };
    const deliveredAt = new Date();

    const result = await Message.updateMany(filter, { $set: { status: 'delivered', deliveredAt } });
    if (result.modifiedCount === 0) return [];

    await this.cache.invalidate(conversationId);
    // Our own deliveredAt stamp identifies exactly the rows this call updated.
    const changed = await Message.find({ conversationId, status: 'delivered', deliveredAt }).lean<LeanMessage[]>();
    return changed.map(toMessageResponse);
  }

  /**
   * Marks every unread message from the other side, up to and including
   * `throughMessageId`, as read. The status change is ONE atomic updateMany
   * with `status: { $ne: 'read' }` in the filter, so two tabs reading at the
   * same time can't conflict and nothing is counted twice.
   */
  async markRead(conversationId: string, readerId: string, throughMessageId: string): Promise<ReadResult | null> {
    const through = await Message.findOne({ _id: throughMessageId, conversationId }).select('createdAt').lean<LeanMessage>();
    if (!through) return null;

    const readAt = new Date();
    const range = {
      conversationId,
      senderId: { $ne: new Types.ObjectId(readerId) },
      createdAt: { $lte: through.createdAt },
    };

    // A message that jumps straight from `sent` to `read` was obviously
    // delivered too, so give it a deliveredAt first (harmless if repeated).
    await Message.updateMany({ ...range, status: 'sent' }, { $set: { deliveredAt: readAt } });
    const result = await Message.updateMany({ ...range, status: { $ne: 'read' } }, { $set: { status: 'read', readAt } });

    if (result.modifiedCount > 0) await this.cache.invalidate(conversationId);
    return { readAt: readAt.toISOString(), updatedCount: result.modifiedCount };
  }

  /** Unread badge per conversation: messages from the other side not yet read by `readerId`. */
  async getUnreadCounts(conversationIds: string[], readerId: string): Promise<Record<string, number>> {
    if (conversationIds.length === 0) return {};
    const rows = await Message.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          conversationId: { $in: conversationIds.map((id) => new Types.ObjectId(id)) },
          status: { $ne: 'read' },
          senderId: { $ne: new Types.ObjectId(readerId) },
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [row._id.toString(), row.count]));
  }

  /**
   * Streams the whole history oldest → newest, one message at a time, so
   * exporting a huge conversation never loads it all into memory.
   */
  async *streamAll(conversationId: string): AsyncGenerator<MessageResponse & { senderName: string }> {
    const cursor = Message.find({ conversationId })
      .sort({ createdAt: 1, _id: 1 })
      .populate<{ senderId: { _id: Types.ObjectId; name: string } | null }>('senderId', 'name')
      .lean()
      .cursor();

    for await (const row of cursor) {
      const sender = row.senderId;
      const message = toMessageResponse({ ...(row as unknown as LeanMessage), senderId: sender?._id ?? new Types.ObjectId() });
      yield { ...message, senderName: sender?.name ?? 'Deleted user' };
    }
  }
}
