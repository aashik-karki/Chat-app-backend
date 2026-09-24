import { Types } from 'mongoose';

/**
 * A support thread has two SIDES: the customer, and the support team (any
 * admin/agent). Read/delivered status and unread counts are per side:
 * "read" means the OTHER side has seen the message. So when agent B opens a
 * thread, agent A's replies are NOT marked read — only the customer's messages.
 */
export type ChatSide = 'customer' | 'staff';

export interface ConversationRef {
  id: string;
  customerId: string;
}

export const sideOf = (conversation: ConversationRef, userId: string): ChatSide =>
  conversation.customerId === userId ? 'customer' : 'staff';

export const otherSide = (side: ChatSide): ChatSide => (side === 'customer' ? 'staff' : 'customer');

/** Mongo filter on `senderId` matching messages written by `side`. */
export const sentBy = (side: ChatSide, customerId: string) => {
  const customer = new Types.ObjectId(customerId);
  return side === 'customer' ? customer : { $ne: customer };
};
