import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { requirePermission } from '../../common/guards/permission.guard.js';
import { rateLimit } from '../../common/middleware/rate-limit.js';
import { validate } from '../../common/middleware/validate.pipe.js';
import type { ConversationsController } from './controllers/conversations.controller.js';
import type { MessagesController } from './controllers/messages.controller.js';
import { conversationIdParamsDto } from './dto/conversation-id-params.dto.js';
import { exportQueryDto } from './dto/export-query.dto.js';
import { historyQueryDto } from './dto/history-query.dto.js';
import { updateTopicDto } from './dto/update-topic.dto.js';
import { requireCsrfToken } from '../../common/guards/csrf.guard.js';

// Exports read a whole conversation, so keep them rare: 10 per user per 10 min.
const exportLimiter = rateLimit({
  name: 'chat-export',
  max: 10,
  windowSeconds: 10 * 60,
  keyBy: (request) => request.session.userId ?? request.ip ?? 'unknown',
});

/** Mounted at /api/v1/conversations */
export const createChatRouter = (conversations: ConversationsController, messages: MessagesController) => {
  const router = Router();
  router.use(requireAuth);

  router.get('/', conversations.list);
  router.get('/mine', requirePermission('chat:read_own'), conversations.mine);
  router.patch(
    '/mine/topic',
    requireCsrfToken,
    requirePermission('chat:send_own'),
    validate({ body: updateTopicDto }),
    conversations.setTopic,
  );
  router.get('/:conversationId', validate({ params: conversationIdParamsDto }), conversations.getOne);

  router.get(
    '/:conversationId/messages',
    validate({ params: conversationIdParamsDto, query: historyQueryDto }),
    messages.history,
  );
  router.get(
    '/:conversationId/messages/export',
    requirePermission('chat:export'),
    exportLimiter,
    validate({ params: conversationIdParamsDto, query: exportQueryDto }),
    messages.export,
  );

  return router;
};
