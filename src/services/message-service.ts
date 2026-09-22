import { Types } from 'mongoose';
import { decodeCursor, encodeCursor } from '../lib/pagination.js';
import { Conversation } from '../models/conversation.js';
import { Message, type MessageDocument } from '../models/message.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

type LeanMessage = MessageDocument & { _id: Types.ObjectId };

export interface SerializedMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  status: MessageDocument['status'];
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

const serializeMessage = (message: LeanMessage): SerializedMessage => ({
  id: message._id.toString(),
  clientMessageId: message.clientMessageId,
  conversationId: message.conversationId.toString(),
  senderId: message.senderId.toString(),
  text: message.text,
  status: message.status,
  createdAt: message.createdAt.toISOString(),
  deliveredAt: message.deliveredAt ? message.deliveredAt.toISOString() : null,
  readAt: message.readAt ? message.readAt.toISOString() : null,
});

export interface MessageHistoryOptions {
  conversationId: string;
  cursor?: string;
  limit?: number;
}

export interface MessageHistoryPage {
  messages: SerializedMessage[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated, oldest-to-newest page of a conversation's history.
 * Walks backwards from `cursor` (or from "now" on the first page) so pages
 * stay stable even while new messages are being written concurrently.
 */
export const getMessageHistory = async ({
  conversationId,
  cursor,
  limit,
}: MessageHistoryOptions): Promise<MessageHistoryPage> => {
  const pageSize = Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const query: Record<string, unknown> = { conversationId };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      query.$or = [
        { createdAt: { $lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, _id: { $lt: decoded.id } },
      ];
    }
  }

  const rows = (await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean()) as LeanMessage[];

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const oldestOnPage = page[page.length - 1];
  const nextCursor = hasMore && oldestOnPage ? encodeCursor(oldestOnPage.createdAt, oldestOnPage._id.toString()) : null;

  return {
    // Reverse to chronological (oldest first) order for rendering in the UI.
    messages: page.map(serializeMessage).reverse(),
    nextCursor,
  };
};

export interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  text: string;
}

const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Persists a message and bumps the conversation's `lastMessageAt`.
 * Idempotent by (conversationId, clientMessageId): a retried send returns the
 * message that was already stored instead of erroring or duplicating it.
 */
export const createMessage = async ({
  conversationId,
  senderId,
  clientMessageId,
  text,
}: CreateMessageInput): Promise<SerializedMessage> => {
  try {
    const message = await Message.create({ conversationId, senderId, clientMessageId, text });
    await Conversation.updateOne(
      { _id: conversationId },
      { $set: { lastMessageAt: message.createdAt, lastMessagePreview: text } },
    );
    return serializeMessage(message.toObject() as LeanMessage);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = (await Message.findOne({ conversationId, clientMessageId }).lean()) as LeanMessage | null;
      if (existing) return serializeMessage(existing);
    }
    throw error;
  }
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE;
