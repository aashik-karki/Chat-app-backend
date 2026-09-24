import type { Role } from '../../../common/auth/permissions.js';

export const accountStatuses = ['pending', 'approved', 'rejected'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export interface UserDocument {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}