import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { requireAuth } from '../middleware/auth.js';
import type { UserRole } from '../models/user.js';
import { getConversationForRequester } from '../services/conversation-service.js';
import { getMessageHistory } from '../services/message-service.js';

const historyQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface CurrentUser {
  _id: unknown;
  role: UserRole;
}

// Mounted at /api/v1/conversations/:conversationId/messages — mergeParams
// makes the parent router's :conversationId available on `request.params`.
export const messagesRouter = Router({ mergeParams: true });

messagesRouter.get('/', requireAuth, async (request, response, next) => {
  try {
    const { conversationId } = request.params as { conversationId: string };
    const currentUser = response.locals.currentUser as CurrentUser;

    // 404s (not 403) for both "unknown id" and "not yours" so this endpoint
    // can't be used to enumerate other customers' conversations. Admins may
    // read any conversation (see conversation-service).
    await getConversationForRequester(conversationId, { id: String(currentUser._id), role: currentUser.role });

    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid pagination parameters');

    const page = await getMessageHistory({ conversationId, ...query.data });
    response.json({ data: page.messages, nextCursor: page.nextCursor });
  } catch (error) {
    next(error);
  }
});
