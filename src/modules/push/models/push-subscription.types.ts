import type { Types } from 'mongoose';

export interface PushSubscriptionDocument {
  userId: Types.ObjectId;
  /** SHA-256 of the endpoint URL (unique; the URL itself is only stored encrypted). */
  endpointHash: string;
  /** AES-GCM encrypted JSON: { endpoint, keys: { p256dh, auth } }. */
  encryptedSubscription: string;
  /** From the browser's PushSubscription.expirationTime (usually null). */
  expiresAt: Date | null;
  userAgent: string | null;
  lastSuccessAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type LeanPushSubscription = PushSubscriptionDocument & { _id: Types.ObjectId };

/** The shape the browser gives us (PushSubscription.toJSON()). */
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
