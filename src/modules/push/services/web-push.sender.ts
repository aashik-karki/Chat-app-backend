import webPush, { WebPushError } from 'web-push';
import { env } from '../../../core/config/env.js';
import type { WebPushSubscription } from '../models/push-subscription.types.js';

export type SendResult =
  | { outcome: 'sent' }
  /** 404/410: the browser unsubscribed or the subscription expired → delete it, never retry. */
  | { outcome: 'gone'; statusCode: number }
  /** 400/401/403/413: our request is wrong → retrying won't help. */
  | { outcome: 'rejected'; statusCode: number; message: string }
  /** 429/5xx/network: temporary → retry with backoff. */
  | { outcome: 'retry'; statusCode: number | null; message: string };

export const isPushConfigured = (): boolean => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (isPushConfigured()) {
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export interface PushPayload {
  type: 'message';
  title: string;
  body: string;
  conversationId: string;
  messageId: string;
  /** Where the service worker should navigate when the notification is clicked. */
  url: string;
  /** Same tag replaces the previous notification of that chat instead of stacking. */
  tag: string;
}

export const sendWebPush = async (subscription: WebPushSubscription, payload: PushPayload): Promise<SendResult> => {
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60, // push services keep it up to 1h if the device is offline
      urgency: 'high',
      topic: payload.conversationId, // a newer push for the same chat replaces an undelivered older one
      timeout: 10_000,
    });
    return { outcome: 'sent' };
  } catch (error) {
    if (error instanceof WebPushError) {
      const { statusCode } = error;
      if (statusCode === 404 || statusCode === 410) return { outcome: 'gone', statusCode };
      if (statusCode === 429 || statusCode >= 500) return { outcome: 'retry', statusCode, message: error.body || error.message };
      return { outcome: 'rejected', statusCode, message: error.body || error.message };
    }
    return { outcome: 'retry', statusCode: null, message: error instanceof Error ? error.message : String(error) };
  }
};
