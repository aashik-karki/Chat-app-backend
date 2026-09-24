import type { Response } from 'express';
import type { Role } from './permissions.js';

/** The user object `requireAuth` puts on res.locals.currentUser. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const getCurrentUser = (response: Response): CurrentUser => {
  const user = response.locals.currentUser as CurrentUser | undefined;
  if (!user) throw new Error('getCurrentUser() used on a route without requireAuth');
  return user;
};