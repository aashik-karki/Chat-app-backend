import { z } from 'zod';
import { roles } from '../../../common/auth/permissions.js';
import { accountStatuses } from '../models/user.types.js';

export const listUsersQueryDto = z.object({
  status: z.enum(accountStatuses).default('pending'),
  role: z.enum(roles).default('user'),
});
export type ListUsersQueryDto = z.infer<typeof listUsersQueryDto>;
