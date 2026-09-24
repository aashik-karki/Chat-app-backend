import { z } from 'zod';
import { objectIdSchema } from '../../../../common/utils/object-id.js';

/** message:read — "I have seen everything up to and including lastMessageId". */
export const readMessagesDto = z.object({
  conversationId: objectIdSchema,
  lastMessageId: objectIdSchema,
});
export type ReadMessagesDto = z.infer<typeof readMessagesDto>;
