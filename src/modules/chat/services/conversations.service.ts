import type { Types } from 'mongoose';
import type { CurrentUser } from '../../../common/auth/current-user.js';
import { hasPermission } from '../../../common/auth/permissions.js';
import { HttpError } from '../../../common/errors/http-error.js';
import { isDuplicateKeyError } from '../../../common/utils/mongo-errors.js';
import { Conversation } from '../models/conversation.model.js';
import type { LeanConversation } from '../models/conversation.types.js';
import type { ConversationRef } from '../chat-side.js';

type Requester = Pick<CurrentUser, 'id' | 'role'>;

const PREVIEW_LENGTH = 200;

export interface ConversationWithCustomer extends Omit<LeanConversation, 'customerId'> {
  customerId: { _id: Types.ObjectId; name: string; email: string } | null;
}

export const toConversationRef = (conversation: Pick<LeanConversation, '_id' | 'customerId'>): ConversationRef => ({
  id: conversation._id.toString(),
  customerId: conversation.customerId.toString(),
});

export class ConversationsService {
  /** Staff (chat:read_any) may open any thread; a customer only their own. */
  canAccess(conversation: Pick<LeanConversation, 'customerId'>, requester: Requester): boolean {
    if (hasPermission(requester.role, 'chat:read_any')) return true;
    return conversation.customerId.toString() === requester.id;
  }

  /**
   * Loads a conversation only if the requester may see it. Always 404 (never
   * 403), so nobody can probe which conversation ids exist.
   */
  async getForRequester(conversationId: string, requester: Requester): Promise<LeanConversation> {
    const conversation = await Conversation.findById(conversationId).lean<LeanConversation>();
    if (!conversation || !this.canAccess(conversation, requester)) {
      throw HttpError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return conversation;
  }

  /** Same access rule as getForRequester, with the customer's name/email filled in. */
  async getWithCustomerForRequester(conversationId: string, requester: Requester): Promise<ConversationWithCustomer> {
    await this.getForRequester(conversationId, requester);
    const conversation = await Conversation.findById(conversationId)
      .populate('customerId', 'name email')
      .lean<ConversationWithCustomer>();
    if (!conversation) throw HttpError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    return conversation;
  }

  /** The customer's support thread, created on first contact. Safe under concurrent calls. */
  async getOrCreateForCustomer(customerId: string): Promise<LeanConversation> {
    const existing = await Conversation.findOne({ customerId }).lean<LeanConversation>();
    if (existing) return existing;

    try {
      const created = await Conversation.create({ customerId });
      return created.toObject() as LeanConversation;
    } catch (error) {
      // Two tabs connected at once: the unique index lets only one insert win.
      if (!isDuplicateKeyError(error)) throw error;
      const winner = await Conversation.findOne({ customerId }).lean<LeanConversation>();
      if (!winner) throw error;
      return winner;
    }
  }

  /** Customer: their own thread. Staff: every thread, most recently active first. */
  async listForRequester(requester: Requester): Promise<ConversationWithCustomer[]> {
    const filter = hasPermission(requester.role, 'chat:read_any') ? {} : { customerId: requester.id };
    return Conversation.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .populate('customerId', 'name email')
      .lean<ConversationWithCustomer[]>();
  }

  /**
   * Updates the thread's "last message" only if this message is newer than
   * the stored one, so two messages saved at the same time can't leave an
   * older preview on top.
   */
  async touchLastMessage(conversationId: string, text: string, sentAt: Date): Promise<void> {
    await Conversation.updateOne(
      { _id: conversationId, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: sentAt } }] },
      { $set: { lastMessageAt: sentAt, lastMessagePreview: text.slice(0, PREVIEW_LENGTH) } },
    );
  }
}
