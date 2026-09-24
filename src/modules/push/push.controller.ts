import type { Request, Response } from 'express';
import { getCurrentUser } from '../../common/auth/current-user.js';
import { HttpError } from '../../common/errors/http-error.js';
import { getBody } from '../../common/middleware/validate.pipe.js';
import { env } from '../../core/config/env.js';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import type { DeleteSubscriptionDto } from './dto/delete-subscription.dto.js';
import type { PushSubscriptionsService } from './services/push-subscriptions.service.js';
import { isPushConfigured } from './services/web-push.sender.js';

export class PushController {
  constructor(private readonly subscriptions: PushSubscriptionsService) {}

  /** GET /push/public-key — the VAPID key the browser needs for pushManager.subscribe(). */
  publicKey = async (_request: Request, response: Response) => {
    if (!isPushConfigured()) throw new HttpError(503, 'PUSH_DISABLED', 'Push notifications are not configured on this server');
    response.json({ publicKey: env.VAPID_PUBLIC_KEY });
  };

  /** POST /push/subscriptions — body is the browser's PushSubscription JSON. */
  subscribe = async (request: Request, response: Response) => {
    if (!isPushConfigured()) throw new HttpError(503, 'PUSH_DISABLED', 'Push notifications are not configured on this server');
    await this.subscriptions.save(getCurrentUser(response).id, getBody<CreateSubscriptionDto>(response), request.get('user-agent'));
    response.status(201).json({ subscribed: true });
  };

  /** DELETE /push/subscriptions — e.g. on logout or when the user turns notifications off. */
  unsubscribe = async (_request: Request, response: Response) => {
    await this.subscriptions.remove(getCurrentUser(response).id, getBody<DeleteSubscriptionDto>(response).endpoint);
    response.status(204).end();
  };
}
