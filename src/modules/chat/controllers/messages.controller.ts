import type { Request, Response } from 'express';
import { getCurrentUser } from '../../../common/auth/current-user.js';
import { getParams, getQuery } from '../../../common/middleware/validate.pipe.js';
import type { ConversationIdParamsDto } from '../dto/conversation-id-params.dto.js';
import type { ExportQueryDto } from '../dto/export-query.dto.js';
import type { HistoryQueryDto } from '../dto/history-query.dto.js';
import type { ChatExportService } from '../services/chat-export.service.js';
import type { ConversationsService } from '../services/conversations.service.js';
import type { MessagesService } from '../services/messages.service.js';

export class MessagesController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly exportService: ChatExportService,
  ) {}

  /** GET /conversations/:conversationId/messages?cursor=&limit= */
  history = async (_request: Request, response: Response) => {
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    await this.conversationsService.getForRequester(conversationId, getCurrentUser(response));

    const page = await this.messagesService.getHistory(conversationId, getQuery<HistoryQueryDto>(response));
    response.json({ data: page.messages, nextCursor: page.nextCursor });
  };

  /** GET /conversations/:conversationId/messages/export?format=json|csv */
  export = async (_request: Request, response: Response) => {
    const { conversationId } = getParams<ConversationIdParamsDto>(response);
    await this.conversationsService.getForRequester(conversationId, getCurrentUser(response));

    const { format } = getQuery<ExportQueryDto>(response);
    await this.exportService.write(conversationId, format, response);
  };
}
