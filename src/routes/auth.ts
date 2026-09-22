import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { issueCsrfToken, requireCsrfToken } from '../middleware/csrf.js';
import { HttpError } from '../lib/http-error.js';
import { User } from '../models/user.js';
import { requireAuth } from '../middleware/auth.js';

const credentialsSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});

const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(100),
});

const asyncRoute = (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

export const authRouter = Router();

authRouter.get('/csrf-token', issueCsrfToken);

authRouter.post('/register', requireCsrfToken, asyncRoute(async (request, response) => {
  const input = registrationSchema.safeParse(request.body);
  if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid registration details');

  const existingUser = await User.exists({ email: input.data.email });
  if (existingUser) throw new HttpError(409, 'EMAIL_IN_USE', 'An account already uses this email address');

  const passwordHash = await bcrypt.hash(input.data.password, 12);
  await User.create({ ...input.data, passwordHash, role: 'user', status: 'pending' });
  response.status(201).json({ message: 'Registration submitted for admin approval' });
}));

authRouter.post('/login', requireCsrfToken, asyncRoute(async (request, response) => {
  const input = credentialsSchema.safeParse(request.body);
  if (!input.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid email or password');

  const user = await User.findOne({ email: input.data.email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(input.data.password, user.passwordHash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (user.status === 'pending') throw new HttpError(403, 'ACCOUNT_PENDING', 'Your account is pending admin approval');
  if (user.status === 'rejected') throw new HttpError(403, 'ACCOUNT_REJECTED', 'Your account registration was rejected');

  request.session.userId = user.id;
  response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

authRouter.post('/logout', requireCsrfToken, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie('chat.sid');
    response.status(204).end();
  });
});

authRouter.get('/me', requireAuth, (_request, response) => {
  const user = response.locals.currentUser;
  response.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});
