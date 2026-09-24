import { z } from 'zod';

export const exportQueryDto = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});
export type ExportQueryDto = z.infer<typeof exportQueryDto>;
