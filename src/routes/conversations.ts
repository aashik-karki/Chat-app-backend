import { Types } from 'mongoose';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import type { UserRole } from '../models/user.js';
import { listConversationsForRequester } from '../services/conversation-service.js';
import { getUnreadCounts } from '../services/message-service.js';

interface CurrentUser {
  _id: unknown;
  role: UserRole;
}

// Populated by conversation-service's `.populate('customerId', 'name email')`.
interface PopulatedCustomer {
  _id: Types.ObjectId;
  name: string;
  email: string;
}

export const conversationsRouter = Router();

// Lists the requester's conversations: a customer's own single support
// thread, or (for an admin) every customer's thread, most recently active
// first. The client decides how to *display* each thread's other party —
// this only reports who the customer actually is, since a customer's own
// conversation always populates `customerId` with their own record.
conversationsRouter.get('/', requireAuth, async (request, response, next) => {
  try {
    const currentUser = response.locals.currentUser as CurrentUser;
    const conversations = await listConversationsForRequester({
      role: currentUser.role,
      userId: String(currentUser._id),
    });

    // A conversation's `customerId` can fail to populate — the referenced
    // user was deleted, or the row predates the customer-thread model — in
    // which case Mongoose leaves it as `null`/unresolved rather than
    // throwing. Skip those instead of crashing the whole list on one bad row.
    const validConversations = conversations.filter((conversation): conversation is typeof conversation & { customerId: PopulatedCustomer } => {
      const customer = conversation.customerId as unknown;
      const isPopulated = Boolean(customer) && typeof customer === 'object' && '_id' in (customer as object);
      if (!isPopulated) {
        logger.warn({ conversationId: conversation._id.toString() }, 'Skipping conversation with an unresolved customer');
      }
      return isPopulated;
    });

    const unreadCounts = await getUnreadCounts(
      validConversations.map((conversation) => conversation._id.toString()),
      String(currentUser._id),
    );

    response.json({
      conversations: validConversations.map((conversation) => {
        const customer = conversation.customerId as unknown as PopulatedCustomer;
        return {
          id: conversation._id.toString(),
          customerId: customer._id.toString(),
          customerName: customer.name,
          customerEmail: customer.email,
          lastMessagePreview: conversation.lastMessagePreview,
          lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
          unreadCount: unreadCounts[conversation._id.toString()] ?? 0,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});
