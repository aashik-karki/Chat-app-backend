import { z } from 'zod';

export const deleteSubscriptionDto = z.object({ endpoint: z.url().max(2000) });
export type DeleteSubscriptionDto = z.infer<typeof deleteSubscriptionDto>;
