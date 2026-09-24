import type { NextFunction, Request, Response } from 'express';
import { User } from '../../modules/users/models/user.model.js';
import type { CurrentUser } from '../auth/current-user.js';
import { HttpError } from '../errors/http-error.js';

/** Like a NestJS AuthGuard: loads the session user or returns 401. */
export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  if (!request.session.userId) throw HttpError.unauthorized();

  const user = await User.findById(request.session.userId).select('name email role status').lean();
  if (!user || user.status !== 'approved') {
    await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
    throw HttpError.unauthorized();
  }

  response.locals.currentUser = {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  } satisfies CurrentUser;
  next();
};