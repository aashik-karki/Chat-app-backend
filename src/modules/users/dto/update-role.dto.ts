import { z } from 'zod';

/** Admins can promote a customer to support agent, or demote back. */
export const updateRoleDto = z.object({
  role: z.enum(['user', 'agent']),
});
export type UpdateRoleDto = z.infer<typeof updateRoleDto>;
