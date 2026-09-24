import type { Types } from 'mongoose';
import type { UserDocument } from './models/user.types.js';

/** The only user shape the API ever returns (never passwordHash, never _id). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserDocument['role'];
  status: UserDocument['status'];
  createdAt: string;
}

type UserLike = Pick<UserDocument, 'name' | 'email' | 'role' | 'status' | 'createdAt'> & { _id: Types.ObjectId };

export const toPublicUser = (user: UserLike): PublicUser => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt.toISOString(),
});
