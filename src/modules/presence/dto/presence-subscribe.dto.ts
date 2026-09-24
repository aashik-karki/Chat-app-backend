import { z } from 'zod';
import { objectIdSchema } from '../../../common/utils/object-id.js';

/** Replaces the socket's presence subscriptions with this list. */
export const presenceSubscribeDto = z.object({
  userIds: z.array(objectIdSchema).max(200),
});
export type PresenceSubscribeDto = z.infer<typeof presenceSubscribeDto>;
