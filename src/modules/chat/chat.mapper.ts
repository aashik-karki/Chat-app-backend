import type { LeanConversation } from './models/conversation.types.js';
import type { LeanMessage, MessageStatus } from './models/message.types.js';

export interface MessageResponse {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  status: MessageStatus;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export const toMessageResponse = (message: LeanMessage): MessageResponse => ({
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

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
}

export interface ConversationResponse {
  id: string;
  customer: CustomerSummary;
  assignedAgentId: string | null;
  status: LeanConversation['status'];
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export const toConversationResponse = (
  conversation: LeanConversation,
  customer: CustomerSummary,
  unreadCount: number,
): ConversationResponse => ({
  id: conversation._id.toString(),
  customer,
  assignedAgentId: conversation.assignedAgentId ? conversation.assignedAgentId.toString() : null,
  status: conversation.status,
  lastMessagePreview: conversation.lastMessagePreview,
  lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
  unreadCount,
});
