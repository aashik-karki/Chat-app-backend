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

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE;

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

/**
 * Flips a single freshly-sent message straight to "delivered" when the
 * recipient is already connected to the conversation's socket room at send
 * time — used by the realtime gateway instead of waiting for a join.
 */
export const markMessageDelivered = async (messageId: string): Promise<SerializedMessage | null> => {
  if (!Types.ObjectId.isValid(messageId)) return null;
  const message = (await Message.findOneAndUpdate(
    { _id: messageId, status: 'sent' },
    { $set: { status: 'delivered', deliveredAt: new Date() } },
    { new: true },
  ).lean()) as LeanMessage | null;
  return message ? serializeMessage(message) : null;
};

/**
 * Called when a socket joins a conversation room: anything the other side
 * sent while this socket was away is now on screen, so it counts as
 * delivered. Returns the messages that changed, for the gateway to notify
 * the original sender about.
 */
export const markMessagesDeliveredOnJoin = async (
  conversationId: string,
  joinerId: string,
): Promise<SerializedMessage[]> => {
  const pending = (await Message.find({
    conversationId,
    senderId: { $ne: joinerId },
    status: 'sent',
  }).lean()) as LeanMessage[];
  if (pending.length === 0) return [];

  const deliveredAt = new Date();
  await Message.updateMany(
    { _id: { $in: pending.map((message) => message._id) } },
    { $set: { status: 'delivered', deliveredAt } },
  );
  return pending.map((message) => serializeMessage({ ...message, status: 'delivered', deliveredAt }));
};

export interface UnreadCounts {
  [conversationId: string]: number;
}

/**
 * How many messages the other side sent, in each of the given
 * conversations, that `readerId` hasn't read yet. Used to seed the
 * conversation list's unread badges on page load (the socket layer keeps
 * them current after that via message:new / message:status).
 */
export const getUnreadCounts = async (conversationIds: string[], readerId: string): Promise<UnreadCounts> => {
  const validIds = conversationIds.filter((id) => Types.ObjectId.isValid(id));
  if (validIds.length === 0) return {};

  const rows = await Message.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        conversationId: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        senderId: { $ne: new Types.ObjectId(readerId) },
        status: { $ne: 'read' },
      },
    },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);

  return Object.fromEntries(rows.map((row) => [row._id.toString(), row.count]));
};

export interface MarkMessagesReadInput {
  conversationId: string;
  readerId: string;
  throughMessageId: string;
}

/**
 * Marks every not-yet-read message from the other side, up through
 * `throughMessageId`, as read. The gateway only reports the read receipt for
 * `throughMessageId` back to the sender (chat UIs conventionally show the
 * receipt on the latest read message, not every one individually).
 */
export const markMessagesRead = async ({
  conversationId,
  readerId,
  throughMessageId,
}: MarkMessagesReadInput): Promise<{ readAt: string } | null> => {
  if (!Types.ObjectId.isValid(throughMessageId)) return null;
  const throughMessage = await Message.findOne({ _id: throughMessageId, conversationId }).select('createdAt').lean();
  if (!throughMessage) return null;

  const readAt = new Date();
  await Message.updateMany(
    {
      conversationId,
      senderId: { $ne: readerId },
      status: { $ne: 'read' },
      createdAt: { $lte: throughMessage.createdAt },
    },
    { $set: { status: 'read', readAt } },
  );
  return { readAt: readAt.toISOString() };
};
