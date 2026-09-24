import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { issueCsrfToken, requireCsrfToken } from '../../common/guards/csrf.guard.js';
import { rateLimit } from '../../common/middleware/rate-limit.js';
import { validate } from '../../common/middleware/validate.pipe.js';
import type { AuthController } from './auth.controller.js';
import { loginDto } from './dto/login.dto.js';
import { registerDto } from './dto/register.dto.js';

// 10 login attempts per IP per 15 min; 5 sign-ups per IP per hour.
const loginLimiter = rateLimit({ name: 'login', max: 10, windowSeconds: 15 * 60 });
const registerLimiter = rateLimit({ name: 'register', max: 5, windowSeconds: 60 * 60 });

/** Mounted at /api/v1/auth */
export const createAuthRouter = (controller: AuthController) => {
  const router = Router();

  router.get('/csrf-token', issueCsrfToken);
  router.post('/register', registerLimiter, requireCsrfToken, validate({ body: registerDto }), controller.register);
  router.post('/login', loginLimiter, requireCsrfToken, validate({ body: loginDto }), controller.login);
  router.post('/logout', requireCsrfToken, controller.logout);
  router.get('/me', requireAuth, controller.me);

  return router;
};
