import { z } from 'zod';
import { objectIdSchema } from '../../../common/utils/object-id.js';

/** agentId: null puts the conversation back in the queue. */
export const transferConversationDto = z.object({ agentId: objectIdSchema.nullable() });
export type TransferConversationDto = z.infer<typeof transferConversationDto>;
