import { z } from 'zod';

export const historyQueryDto = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type HistoryQueryDto = z.infer<typeof historyQueryDto>;
