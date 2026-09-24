import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { requireCsrfToken } from '../../common/guards/csrf.guard.js';
import { rateLimit } from '../../common/middleware/rate-limit.js';
import { validate } from '../../common/middleware/validate.pipe.js';
import { createSubscriptionDto } from './dto/create-subscription.dto.js';
import { deleteSubscriptionDto } from './dto/delete-subscription.dto.js';
import type { PushController } from './push.controller.js';

const subscribeLimiter = rateLimit({
  name: 'push-subscribe',
  max: 20,
  windowSeconds: 60 * 60,
  keyBy: (request) => request.session.userId ?? request.ip ?? 'unknown',
});

/** Mounted at /api/v1/push */
export const createPushRouter = (controller: PushController) => {
  const router = Router();
  router.use(requireAuth, requireCsrfToken);
  router.get('/public-key', controller.publicKey);
  router.post('/subscriptions', subscribeLimiter, validate({ body: createSubscriptionDto }), controller.subscribe);
  router.delete('/subscriptions', validate({ body: deleteSubscriptionDto }), controller.unsubscribe);
  return router;
};
