import { Schema } from 'mongoose';
import type { PushSubscriptionDocument } from '../models/push-subscription.types.js';

export const pushSubscriptionSchema = new Schema<PushSubscriptionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    endpointHash: { type: String, required: true },
    encryptedSubscription: { type: String, required: true },
    expiresAt: { type: Date, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    lastSuccessAt: { type: Date, default: null },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// One row per browser; re-subscribing the same browser updates it (even if another user logs in there).
pushSubscriptionSchema.index({ endpointHash: 1 }, { unique: true });
// "All devices of this user".
pushSubscriptionSchema.index({ userId: 1 });
// Browsers can report an expiry: let MongoDB delete those rows automatically.
pushSubscriptionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });
