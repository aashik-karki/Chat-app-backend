import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireAuth } from '../middleware/auth.js';
import { requireCsrfToken } from '../middleware/csrf.js';
import { HttpError } from '../lib/http-error.js';
import { User, accountStatuses } from '../models/user.js';

const statusSchema = z.enum(accountStatuses);

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuth, requireRole('admin'));

adminUsersRouter.get('/', async (request, response, next) => {
  try {
    const status = request.query.status === undefined ? 'pending' : statusSchema.parse(request.query.status);
    const users = await User.find({ role: 'user', status })
      .select('name email role status createdAt')
      .sort({ createdAt: -1 })
      .lean();

    response.json({
      // Lean documents carry `_id` (an ObjectId), not the client-facing `id`
      // string, so map explicitly rather than leaking a Mongo-shaped object.
      users: users.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminUsersRouter.patch('/:userId/approval', requireCsrfToken, async (request, response, next) => {
  try {
    const body = z.object({ status: z.enum(['approved', 'rejected']) }).safeParse(request.body);
    if (!body.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Status must be approved or rejected');

    const user = await User.findOneAndUpdate(
      { _id: request.params.userId, role: 'user', status: 'pending' },
      { $set: { status: body.data.status } },
      { new: true },
    ).select('name email role status');
    if (!user) throw new HttpError(404, 'PENDING_USER_NOT_FOUND', 'Pending user not found');

    response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
  } catch (error) {
    next(error);
  }
});
