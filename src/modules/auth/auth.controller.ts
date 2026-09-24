import type { Request, Response } from 'express';
import { getCurrentUser } from '../../common/auth/current-user.js';
import { createCsrfToken } from '../../common/guards/csrf.guard.js';
import { getBody } from '../../common/middleware/validate.pipe.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../../core/session/session.js';
import { destroySession, regenerateSession, saveSession } from '../../core/session/session-helpers.js';
import type { AuthService } from './auth.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  register = async (_request: Request, response: Response) => {
    const user = await this.authService.register(getBody<RegisterDto>(response));
    response.status(201).json({ user });
  };

  login = async (request: Request, response: Response) => {
    const user = await this.authService.validateCredentials(getBody<LoginDto>(response));

    // New session id on login → stops session fixation. The old CSRF token
    // dies with the old session, so a fresh one is returned to the client.
    await regenerateSession(request);
    request.session.userId = user.id;
    const csrfToken = createCsrfToken(request);
    await saveSession(request);

    response.json({ user, csrfToken });
  };

  logout = async (request: Request, response: Response) => {
    await destroySession(request);
    // Same path/flags as when it was set, otherwise the browser keeps it.
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: sessionCookieOptions.httpOnly,
      secure: sessionCookieOptions.secure === true,
      sameSite: sessionCookieOptions.sameSite,
      path: '/',
    });
    response.status(204).end();
  };

  me = async (_request: Request, response: Response) => {
    response.json({ user: getCurrentUser(response) });
  };
}
