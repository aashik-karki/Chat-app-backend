import { model } from 'mongoose';
import { pushSubscriptionSchema } from '../schemas/push-subscription.schema.js';
import type { PushSubscriptionDocument } from './push-subscription.types.js';

export const PushSubscriptionModel = model<PushSubscriptionDocument>('PushSubscription', pushSubscriptionSchema);
