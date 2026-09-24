import { isRedisReady, redis } from '../../core/redis/redis.js';
import type { AppServer } from '../../realtime/socket.types.js';
import type { UsersService } from '../users/users.service.js';
import { ChatGateway } from './chat.gateway.js';
import { createChatRouter } from './chat.routes.js';
import { ConversationsController } from './controllers/conversations.controller.js';
import { MessagesController } from './controllers/messages.controller.js';
import { ChatExportService } from './services/chat-export.service.js';
import { ConversationsService } from './services/conversations.service.js';
import { MessageCacheService } from './services/message-cache.service.js';
import { MessagesService } from './services/messages.service.js';

/**
 * Like a NestJS ChatModule. Conversations and messages live in one module
 * because they depend on each other (messages need conversation access
 * checks; the conversation list needs unread counts from messages).
 * The services are returned so other modules (agents, push) can reuse them.
 */
export const createChatModule = ({ usersService }: { usersService: UsersService }) => {
  const conversationsService = new ConversationsService();
  const messageCache = new MessageCacheService(redis, isRedisReady);
  const messagesService = new MessagesService(conversationsService, messageCache);
  const exportService = new ChatExportService(messagesService);

  const conversationsController = new ConversationsController(conversationsService, messagesService, usersService);
  const messagesController = new MessagesController(conversationsService, messagesService, exportService);

  return {
    conversationsService,
    messagesService,
    router: createChatRouter(conversationsController, messagesController),
    /** Created once the Socket.IO server exists (see main.ts). */
    createGateway: (io: AppServer) => new ChatGateway(io, conversationsService, messagesService),
  };
};
