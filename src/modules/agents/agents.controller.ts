import type { Request, Response } from 'express';
import { getCurrentUser } from '../../common/auth/current-user.js';
import { getBody, getParams } from '../../common/middleware/validate.pipe.js';
import type { ConversationIdParamsDto } from '../chat/dto/conversation-id-params.dto.js';
import type { ConversationsService } from '../chat/services/conversations.service.js';
import type { AgentIdParamsDto } from './dto/agent-id-params.dto.js';
import type { SetAvailabilityDto } from './dto/set-availability.dto.js';
import type { TransferConversationDto } from './dto/transfer-conversation.dto.js';
import type { UpdateAgentSettingsDto } from './dto/update-agent-settings.dto.js';
import type { AgentsService } from './services/agents.service.js';
import type { AssignmentService } from './services/assignment.service.js';

export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly assignment: AssignmentService,
    private readonly conversations: ConversationsService,
  ) {}

  /** GET /agents — dashboard: every agent with live status and load. */
  list = async (_request: Request, response: Response) => {
    response.json({ agents: await this.agents.listStatuses() });
  };

  /** GET /agents/queue — conversations waiting for an agent, oldest first. */
  queue = async (_request: Request, response: Response) => {
    const waiting = await this.conversations.listQueue(200);
    response.json({
      queue: waiting.map((conversation) => ({
        conversationId: conversation._id.toString(),
        customerId: conversation.customerId.toString(),
        topic: conversation.topic ?? 'general',
        lastMessagePreview: conversation.lastMessagePreview,
        waitingSince: conversation.lastMessageAt?.toISOString() ?? null,
      })),
    });
  };

  /** PATCH /agents/me/status */
  setMyStatus = async (_request: Request, response: Response) => {
    const agent = getCurrentUser(response);
    const { availability } = getBody<SetAvailabilityDto>(response);
    response.json({ agent: await this.agents.setAvailability(agent.id, availability) });
  };

  /** PATCH /agents/:agentId/settings (admin) */
  updateSettings = async (_request: Request, response: Response) => {
    const { agentId } = getParams<AgentIdParamsDto>(response);
    response.json({ agent: await this.agents.updateSettings(agentId, getBody<UpdateAgentSettingsDto>(response)) });
  };

  /** POST /agents/conversations/:conversationId/claim */
  claim = async (_request: Request, response: Response) => {
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    const conversation = await this.assignment.claim(conversationId, getCurrentUser(response));
    response.json({ conversationId, assignedAgentId: conversation.assignedAgentId?.toString() ?? null });
  };

  /** POST /agents/conversations/:conversationId/transfer (admin) */
  transfer = async (_request: Request, response: Response) => {
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    const { agentId } = getBody<TransferConversationDto>(response);
    const conversation = await this.assignment.transfer(conversationId, agentId);
    response.json({ conversationId, assignedAgentId: conversation.assignedAgentId?.toString() ?? null });
  };

  /** POST /agents/conversations/:conversationId/close */
  close = async (_request: Request, response: Response) => {
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    await this.assignment.close(conversationId, getCurrentUser(response));
    response.status(204).end();
  };
}
