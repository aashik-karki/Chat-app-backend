import { z } from 'zod';
import { objectIdSchema } from '../../../common/utils/object-id.js';

export const conversationIdParamsDto = z.object({ conversationId: objectIdSchema });
export type ConversationIdParamsDto = z.infer<typeof conversationIdParamsDto>;
