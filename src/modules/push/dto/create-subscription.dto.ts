import { z } from 'zod';

/** Exactly what `JSON.stringify(pushSubscription)` gives in the browser. */
export const createSubscriptionDto = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type CreateSubscriptionDto = z.infer<typeof createSubscriptionDto>;
