import { Types } from 'mongoose';

const { ObjectId } = Types;
import type { CurrentUser } from '../../../common/auth/current-user.js';
import { hasPermission } from '../../../common/auth/permissions.js';
import { HttpError } from '../../../common/errors/http-error.js';
import { isDuplicateKeyError } from '../../../common/utils/mongo-errors.js';
import { Conversation } from '../models/conversation.model.js';
import type { ConversationTopic, LeanConversation } from '../models/conversation.types.js';
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

  async setTopic(customerId: string, topic: ConversationTopic): Promise<LeanConversation> {
    await this.getOrCreateForCustomer(customerId);
    const updated = await Conversation.findOneAndUpdate({ customerId }, { $set: { topic } }, { returnDocument: 'after' }).lean<LeanConversation>();
    if (!updated) throw HttpError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    return updated;
  }

  async findById(conversationId: string): Promise<LeanConversation | null> {
    return Conversation.findById(conversationId).lean<LeanConversation>();
  }

  // ---------- Assignment primitives (used by the agents module) ----------
  // Each one is a single conditional update, so concurrent callers on
  // different servers can't both "win" the same conversation.

  /** Assigns only if nobody has it yet. Returns the updated thread, or null if someone else got it first. */
  async assignIfUnassigned(conversationId: string, agentId: string): Promise<LeanConversation | null> {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, assignedAgentId: null, status: 'open' },
      { $set: { assignedAgentId: agentId, assignedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<LeanConversation>();
  }

  /** Moves a thread from `fromAgentId` (or from nobody, if null) to `toAgentId` (or back to the queue, if null). */
  async reassign(conversationId: string, fromAgentId: string | null, toAgentId: string | null): Promise<LeanConversation | null> {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, assignedAgentId: fromAgentId, status: 'open' },
      { $set: { assignedAgentId: toAgentId, assignedAt: toAgentId ? new Date() : null } },
      { returnDocument: 'after' },
    ).lean<LeanConversation>();
  }

  async close(conversationId: string): Promise<LeanConversation | null> {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, status: 'open' },
      { $set: { status: 'closed', assignedAgentId: null, assignedAt: null } },
      { returnDocument: 'before' }, // the caller needs to know who had it
    ).lean<LeanConversation>();
  }

  /** A customer writing into a closed thread opens it again (it goes back to the queue). */
  async reopenIfClosed(conversationId: string): Promise<boolean> {
    const result = await Conversation.updateOne({ _id: conversationId, status: 'closed' }, { $set: { status: 'open' } });
    return result.modifiedCount > 0;
  }

  /** Open threads with at least one message and no agent, oldest waiting first. */
  async listQueue(limit = 50): Promise<LeanConversation[]> {
    return Conversation.find({ status: 'open', assignedAgentId: null, lastMessageAt: { $ne: null } })
      .sort({ lastMessageAt: 1 })
      .limit(limit)
      .lean<LeanConversation[]>();
  }

  async listOpenAssignedTo(agentId: string): Promise<LeanConversation[]> {
    return Conversation.find({ status: 'open', assignedAgentId: agentId }).lean<LeanConversation[]>();
  }

  /** Open threads assigned to anyone NOT in `agentIds` (demoted/deleted agents). */
  async listOpenAssignedOutside(agentIds: string[]): Promise<LeanConversation[]> {
    return Conversation.find({ status: 'open', assignedAgentId: { $nin: [null, ...agentIds] } }).lean<LeanConversation[]>();
  }

  /** Real number of open chats per agent — the source of truth for load balancing. */
  async countOpenByAgent(agentIds: string[]): Promise<Record<string, number>> {
    const counts = Object.fromEntries(agentIds.map((id) => [id, 0]));
    if (agentIds.length === 0) return counts;
    const rows = await Conversation.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { status: 'open', assignedAgentId: { $in: agentIds.map((id) => new ObjectId(id)) } } },
      { $group: { _id: '$assignedAgentId', count: { $sum: 1 } } },
    ]);
    for (const row of rows) counts[row._id.toString()] = row.count;
    return counts;
  }

  countQueue(): Promise<number> {
    return Conversation.countDocuments({ status: 'open', assignedAgentId: null, lastMessageAt: { $ne: null } });
  }

  countOpen(): Promise<number> {
    return Conversation.countDocuments({ status: 'open', lastMessageAt: { $ne: null } });
  }
}
