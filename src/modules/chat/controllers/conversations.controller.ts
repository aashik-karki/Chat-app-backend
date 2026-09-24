import type { Request, Response } from 'express';
import { getCurrentUser } from '../../../common/auth/current-user.js';
import { getParams } from '../../../common/middleware/validate.pipe.js';
import { logger } from '../../../core/logger.js';
import { toConversationResponse, type ConversationResponse } from '../chat.mapper.js';
import type { ConversationIdParamsDto } from '../dto/conversation-id-params.dto.js';
import type { ConversationsService, ConversationWithCustomer } from '../services/conversations.service.js';
import type { MessagesService } from '../services/messages.service.js';

const DELETED_CUSTOMER = { name: 'Deleted user', email: '' };

/** Turns a populated conversation row into the API shape. */
const toResponse = (row: ConversationWithCustomer, unreadCount: number): ConversationResponse => {
  const customer = row.customerId;
  const customerId = customer?._id;
  if (!customerId) logger.warn({ conversationId: row._id.toString() }, 'Conversation customer no longer exists');
  return toConversationResponse(
    { ...row, customerId: customerId ?? row._id },
    customer
      ? { id: customer._id.toString(), name: customer.name, email: customer.email }
      : { id: '', ...DELETED_CUSTOMER },
    unreadCount,
  );
};

export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
  ) {}

  /** GET /conversations — customer: own thread; staff: every thread. */
  list = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const rows = await this.conversationsService.listForRequester(user);
    const unread = await this.messagesService.getUnreadCounts(
      rows.map((row) => row._id.toString()),
      user.id,
    );
    response.json({ conversations: rows.map((row) => toResponse(row, unread[row._id.toString()] ?? 0)) });
  };

  /** GET /conversations/mine — the customer's own thread, created on first use. */
  mine = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const conversation = await this.conversationsService.getOrCreateForCustomer(user.id);
    const unread = await this.messagesService.getUnreadCounts([conversation._id.toString()], user.id);
    response.json({
      conversation: toConversationResponse(
        conversation,
        { id: user.id, name: user.name, email: user.email },
        unread[conversation._id.toString()] ?? 0,
      ),
    });
  };

  /** GET /conversations/:conversationId */
  getOne = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    const row = await this.conversationsService.getWithCustomerForRequester(conversationId, user);
    const unread = await this.messagesService.getUnreadCounts([conversationId], user.id);
    response.json({ conversation: toResponse(row, unread[conversationId] ?? 0) });
  };
}
