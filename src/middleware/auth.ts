import type { NextFunction, Request, Response } from 'express';
import { User, type UserRole } from '../models/user.js';
import { HttpError } from '../lib/http-error.js';

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!request.session.userId) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');

    const user = await User.findById(request.session.userId).select('name email role status').lean();
    if (!user || user.status !== 'approved') {
      request.session.destroy(() => undefined);
      throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
    }

    response.locals.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (role: UserRole) => (request: Request, response: Response, next: NextFunction) => {
  const user = response.locals.currentUser as { role?: UserRole } | undefined;
  if (!user || user.role !== role) return next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'));
  next();
};
