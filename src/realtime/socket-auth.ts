import type { IncomingMessage } from 'node:http';
import type { Session, SessionData } from 'express-session';
import type { Server, Socket } from 'socket.io';
import { logger } from '../lib/logger.js';
import { User, type UserRole } from '../models/user.js';

export interface AuthenticatedSocketUser {
  id: string;
  role: UserRole;
  name: string;
}

export const getSocketUser = (socket: Socket): AuthenticatedSocketUser => socket.data.user as AuthenticatedSocketUser;

// `socket.request` is a plain `http.IncomingMessage`; express-session's type
// augmentation only reaches `Express.Request`, not this raw request, even
// though `io.engine.use(sessionMiddleware)` (see server.ts) populates the
// same `.session` property on it at runtime.
type RequestWithSession = IncomingMessage & { session?: Session & Partial<SessionData> };

/**
 * Authenticates a Socket.IO handshake off the same HttpOnly session cookie
 * the REST API uses — no separate token. Requires `io.engine.use(sessionMiddleware)`
 * to already be wired up (see server.ts), which is what populates
 * `socket.request.session` before this middleware runs.
 */
export const attachSocketAuth = (io: Server) => {
  io.use(async (socket, next) => {
    try {
      const session = (socket.request as RequestWithSession).session;
      if (!session?.userId) {
        next(new Error('AUTHENTICATION_REQUIRED'));
        return;
      }

      const user = await User.findById(session.userId).select('name role status').lean();
      if (!user || user.status !== 'approved') {
        next(new Error('AUTHENTICATION_REQUIRED'));
        return;
      }

      socket.data.user = { id: user._id.toString(), role: user.role, name: user.name } satisfies AuthenticatedSocketUser;
      next();
    } catch (error) {
      logger.error({ error }, 'Socket handshake authentication failed');
      next(new Error('AUTHENTICATION_REQUIRED'));
    }
  });
};
