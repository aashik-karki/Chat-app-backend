import { z } from 'zod';
import { objectIdSchema } from '../../../../common/utils/object-id.js';

/** typing:set — clients send `true` at most every ~2s while typing, `false` when they stop. */
export const typingDto = z.object({
  conversationId: objectIdSchema,
  isTyping: z.boolean(),
});
export type TypingDto = z.infer<typeof typingDto>;
