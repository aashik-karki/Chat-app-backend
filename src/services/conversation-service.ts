import { Types } from 'mongoose';
import { HttpError } from '../lib/http-error.js';
import { Conversation, type ConversationDocument } from '../models/conversation.js';
import type { UserRole } from '../models/user.js';

export const isValidObjectId = (value: string): boolean => Types.ObjectId.isValid(value);

interface Requester {
  id: string;
  role: UserRole;
}

const DUPLICATE_KEY_ERROR_CODE = 11000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE;

/**
 * Loads a conversation only if `requester` may see it: the customer who
 * owns the thread, or any admin (support is handled collectively for now;
 * agent assignment/routing is a later feature). 404s (not 403s) either way
 * so a client can't use this to probe which conversation ids exist.
 */
export const getConversationForRequester = async (
  conversationId: string,
  requester: Requester,
): Promise<ConversationDocument & { _id: Types.ObjectId }> => {
  if (!isValidObjectId(conversationId)) {
    throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const filter = requester.role === 'admin' ? { _id: conversationId } : { _id: conversationId, customerId: requester.id };

  const conversation = await Conversation.findOne(filter).lean();
  if (!conversation) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  return conversation;
};

/**
 * Returns the customer's support conversation, creating it on first contact.
 * Idempotent under concurrent calls: a race on the unique `customerId` index
 * falls back to fetching the row the other request just created.
 */
export const getOrCreateSupportConversation = async (
  customerId: string,
): Promise<ConversationDocument & { _id: Types.ObjectId }> => {
  const existing = await Conversation.findOne({ customerId }).lean();
  if (existing) return existing;

  try {
    const created = await Conversation.create({ customerId });
    return created.toObject();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const raceWinner = await Conversation.findOne({ customerId }).lean();
      if (raceWinner) return raceWinner;
    }
    throw error;
  }
};

interface ListOptions {
  role: UserRole;
  userId: string;
}

/** A customer sees only their own thread; an admin sees every thread. */
export const listConversationsForRequester = ({ role, userId }: ListOptions) => {
  const filter = role === 'admin' ? {} : { customerId: userId };
  return Conversation.find(filter)
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .populate('customerId', 'name email')
    .lean();
};
