import type { Request, Response } from 'express';
import { getCurrentUser } from '../../../common/auth/current-user.js';
import { hasPermission } from '../../../common/auth/permissions.js';
import { getBody, getParams } from '../../../common/middleware/validate.pipe.js';
import { logger } from '../../../core/logger.js';
import { sideOf } from '../chat-side.js';
import { toConversationResponse, type ConversationResponse } from '../chat.mapper.js';
import type { ConversationIdParamsDto } from '../dto/conversation-id-params.dto.js';
import type { UpdateTopicDto } from '../dto/update-topic.dto.js';
import {
  toConversationRef,
  type ConversationsService,
  type ConversationWithCustomer,
} from '../services/conversations.service.js';
import type { MessagesService } from '../services/messages.service.js';

/** Turns a populated conversation row into the API shape. Deleted customers become "Deleted user". */
const toResponse = (row: ConversationWithCustomer, unreadCount: number): ConversationResponse => {
  const customer = row.customerId;
  if (!customer) logger.warn({ conversationId: row._id.toString() }, 'Conversation customer no longer exists');
  return toConversationResponse(
    { ...row, customerId: customer?._id ?? row._id },
    customer
      ? { id: customer._id.toString(), name: customer.name, email: customer.email }
      : { id: '', name: 'Deleted user', email: '' },
    unreadCount,
  );
};

const refOf = (row: ConversationWithCustomer) => ({ id: row._id.toString(), customerId: row.customerId?._id.toString() ?? '' });

export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
  ) {}

  /** GET /conversations — customer: own thread; staff: every thread. */
  list = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const rows = (await this.conversationsService.listForRequester(user)).filter((row) => row.customerId);
    const side = hasPermission(user.role, 'chat:read_any') ? 'staff' : 'customer';
    const unread = await this.messagesService.getUnreadCounts(rows.map(refOf), side);
    response.json({ conversations: rows.map((row) => toResponse(row, unread[row._id.toString()] ?? 0)) });
  };

  /** GET /conversations/mine — the customer's own thread, created on first use. */
  mine = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const conversation = await this.conversationsService.getOrCreateForCustomer(user.id);
    const ref = toConversationRef(conversation);
    const unread = await this.messagesService.getUnreadCounts([ref], 'customer');
    response.json({
      conversation: toConversationResponse(
        conversation,
        { id: user.id, name: user.name, email: user.email },
        unread[ref.id] ?? 0,
      ),
    });
  };

  /** GET /conversations/:conversationId */
  getOne = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    const row = await this.conversationsService.getWithCustomerForRequester(conversationId, user);
    const ref = refOf(row);
    const unread = await this.messagesService.getUnreadCounts([ref], sideOf(ref, user.id));
    response.json({ conversation: toResponse(row, unread[conversationId] ?? 0) });
  };

  /** PATCH /conversations/mine/topic — the customer says what they need help with (used for routing). */
  setTopic = async (_request: Request, response: Response) => {
    const user = getCurrentUser(response);
    const conversation = await this.conversationsService.setTopic(user.id, getBody<UpdateTopicDto>(response).topic);
    const ref = toConversationRef(conversation);
    const unread = await this.messagesService.getUnreadCounts([ref], 'customer');
    response.json({
      conversation: toConversationResponse(conversation, { id: user.id, name: user.name, email: user.email }, unread[ref.id] ?? 0),
    });
  };
}
