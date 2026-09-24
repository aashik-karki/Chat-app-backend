import type { AppServer } from '../../realtime/socket.types.js';
import type { ChatGateway } from '../chat/chat.gateway.js';
import type { ConversationsService } from '../chat/services/conversations.service.js';
import type { PresenceService } from '../presence/presence.service.js';
import type { UsersService } from '../users/users.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsGateway } from './agents.gateway.js';
import { createAgentsRouter } from './agents.routes.js';
import { AgentsService } from './services/agents.service.js';
import { AssignmentService } from './services/assignment.service.js';

interface AgentsModuleDeps {
  usersService: UsersService;
  conversationsService: ConversationsService;
  presenceService: PresenceService;
}

/** Like a NestJS AgentsModule that imports Users, Chat and Presence. */
export const createAgentsModule = ({ usersService, conversationsService, presenceService }: AgentsModuleDeps) => {
  const agentsService = new AgentsService(usersService, presenceService);
  const assignmentService = new AssignmentService(agentsService, conversationsService, presenceService, usersService);
  const controller = new AgentsController(agentsService, assignmentService, conversationsService);

  // Agent status changes (chosen or connection) drive routing and dashboards.
  agentsService.onStatusChange(assignmentService.onAgentStatusChange);
  presenceService.onChange(({ userId }) => {
    void agentsService
      .isAgent(userId)
      .then(async (isAgent) => {
        if (!isAgent) return;
        const status = await agentsService.broadcastStatus(userId);
        assignmentService.onAgentStatusChange(userId, status.status);
      })
      .catch(() => undefined);
  });

  return {
    agentsService,
    assignmentService,
    router: createAgentsRouter(controller),
    gateway: new AgentsGateway(agentsService),
    /** Call once the Socket.IO server and chat gateway exist. */
    start: (io: AppServer, chatGateway: ChatGateway) => {
      agentsService.start(io);
      assignmentService.start(io);
      chatGateway.setStaffReplyGuard(assignmentService.staffReplyGuard);
      chatGateway.onMessageCreated((event) => void assignmentService.onMessageCreated(event));
    },
    stop: () => assignmentService.stop(),
  };
};
