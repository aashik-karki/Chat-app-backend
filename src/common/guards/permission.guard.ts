import type { NextFunction, Request, Response } from 'express';
import { getCurrentUser } from '../auth/current-user.js';
import { hasPermission, type Permission } from '../auth/permissions.js';
import { HttpError } from '../errors/http-error.js';

/**
 * Like a NestJS RolesGuard, but permission-based. Use after requireAuth:
 *   router.get('/', requireAuth, requirePermission('agent:view'), ctrl.list)
 * Pass several permissions to require ALL of them.
 */
export const requirePermission =
  (...required: Permission[]) =>
  (_request: Request, response: Response, next: NextFunction) => {
    const user = getCurrentUser(response);
    const allowed = required.every((permission) => hasPermission(user.role, permission));
    if (!allowed) return next(HttpError.forbidden());
    next();
  };