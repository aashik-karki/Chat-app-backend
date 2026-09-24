import type { Types } from 'mongoose';

export const conversationStatuses = ['open', 'closed'] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

/** What the customer needs help with. Used for skill-based routing to agents. */
export const conversationTopics = ['general', 'billing', 'technical', 'sales'] as const;
export type ConversationTopic = (typeof conversationTopics)[number];

export interface ConversationDocument {
  /** The customer this support thread belongs to (one thread per customer). */
  customerId: Types.ObjectId;
  /** Support agent handling the thread. null = waiting in the queue (used by the agents module). */
  assignedAgentId: Types.ObjectId | null;
  status: ConversationStatus;
  topic: ConversationTopic;
  /** When the thread got its current agent (null while queued). */
  assignedAt: Date | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeanConversation = ConversationDocument & { _id: Types.ObjectId };
