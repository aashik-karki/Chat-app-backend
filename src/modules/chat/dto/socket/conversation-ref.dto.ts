import { z } from 'zod';
import { objectIdSchema } from '../../../../common/utils/object-id.js';

/** conversation:join / conversation:leave */
export const conversationRefDto = z.object({ conversationId: objectIdSchema });
export type ConversationRefDto = z.infer<typeof conversationRefDto>;
