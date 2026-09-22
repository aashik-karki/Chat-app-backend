import { Types } from 'mongoose';
import { HttpError } from '../lib/http-error.js';
import { Conversation, type ConversationDocument } from '../models/conversation.js';

export const isValidObjectId = (value: string): boolean => Types.ObjectId.isValid(value);

/**
 * Loads a conversation only if `userId` is one of its participants. Used to
 * authorize access to a conversation's history and, later, its socket room.
 * Returns a 404 (not 403) for both "does not exist" and "not yours" so a
 * client cannot use this endpoint to probe which conversation ids exist.
 */
export const getConversationForParticipant = async (
  conversationId: string,
  userId: string,
): Promise<ConversationDocument & { _id: Types.ObjectId }> => {
  if (!isValidObjectId(conversationId)) {
    throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const conversation = await Conversation.findOne({ _id: conversationId, participants: userId }).lean();
  if (!conversation) {
    throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  return conversation;
};

/** Returns the existing direct conversation between two users, or creates one. */
export const getOrCreateDirectConversation = async (
  participantA: string,
  participantB: string,
): Promise<ConversationDocument & { _id: Types.ObjectId }> => {
  const existing = await Conversation.findOne({
    participants: { $all: [participantA, participantB], $size: 2 },
  }).lean();
  if (existing) return existing;

  const created = await Conversation.create({ participants: [participantA, participantB] });
  return created.toObject();
};

export const listConversationsForUser = (userId: string) =>
  Conversation.find({ participants: userId }).sort({ lastMessageAt: -1, createdAt: -1 }).lean();
