import { z } from 'zod';

export const updateApprovalDto = z.object({
  status: z.enum(['approved', 'rejected']),
});
export type UpdateApprovalDto = z.infer<typeof updateApprovalDto>;
