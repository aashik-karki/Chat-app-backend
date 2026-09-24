import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { requireCsrfToken } from '../../common/guards/csrf.guard.js';
import { requirePermission } from '../../common/guards/permission.guard.js';
import { validate } from '../../common/middleware/validate.pipe.js';
import { conversationIdParamsDto } from '../chat/dto/conversation-id-params.dto.js';
import type { AgentsController } from './agents.controller.js';
import { agentIdParamsDto } from './dto/agent-id-params.dto.js';
import { setAvailabilityDto } from './dto/set-availability.dto.js';
import { transferConversationDto } from './dto/transfer-conversation.dto.js';
import { updateAgentSettingsDto } from './dto/update-agent-settings.dto.js';

/** Mounted at /api/v1/agents */
export const createAgentsRouter = (controller: AgentsController) => {
  const router = Router();
  router.use(requireAuth, requireCsrfToken); // CSRF guard skips GET/HEAD/OPTIONS

  router.get('/', requirePermission('agent:view'), controller.list);
  router.get('/queue', requirePermission('agent:view'), controller.queue);
  router.patch('/me/status', requirePermission('agent:set_status'), validate({ body: setAvailabilityDto }), controller.setMyStatus);
  router.patch(
    '/:agentId/settings',
    requirePermission('agent:manage'),
    validate({ params: agentIdParamsDto, body: updateAgentSettingsDto }),
    controller.updateSettings,
  );

  router.post('/conversations/:conversationId/claim', requirePermission('chat:reply'), validate({ params: conversationIdParamsDto }), controller.claim);
  router.post(
    '/conversations/:conversationId/transfer',
    requirePermission('agent:assign'),
    validate({ params: conversationIdParamsDto, body: transferConversationDto }),
    controller.transfer,
  );
  router.post('/conversations/:conversationId/close', requirePermission('chat:reply'), validate({ params: conversationIdParamsDto }), controller.close);

  return router;
};
