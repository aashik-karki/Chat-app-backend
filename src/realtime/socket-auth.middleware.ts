import type { IncomingMessage } from 'node:http';
import type { Session, SessionData } from 'express-session';
import { logger } from '../core/logger.js';
import { User } from '../modules/users/models/user.model.js';
import type { AppServer, SocketUser } from './socket.types.js';

// io.engine.use(sessionMiddleware) puts the session on the raw request.
type RequestWithSession = IncomingMessage & { session?: Session & Partial<SessionData> };

/**
 * Authenticates the handshake with the SAME HttpOnly session cookie as the
 * REST API — no token in the URL or in JS. Unapproved/unknown users are refused.
 */
export const attachSocketAuth = (io: AppServer) => {
  io.use(async (socket, next) => {
    try {
      const session = (socket.request as RequestWithSession).session;
      if (!session?.userId) return next(new Error('AUTHENTICATION_REQUIRED'));

      const user = await User.findById(session.userId).select('name role status').lean();
      if (!user || user.status !== 'approved') return next(new Error('AUTHENTICATION_REQUIRED'));

      socket.data.user = { id: user._id.toString(), name: user.name, role: user.role } satisfies SocketUser;
      next();
    } catch (error) {
      logger.error({ error }, 'Socket handshake authentication failed');
      next(new Error('AUTHENTICATION_REQUIRED'));
    }
  });
};
