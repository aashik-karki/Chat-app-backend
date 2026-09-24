import type { CreateSubscriptionDto } from '../dto/create-subscription.dto.js';
import { PushSubscriptionModel } from '../models/push-subscription.model.js';
import type { LeanPushSubscription, WebPushSubscription } from '../models/push-subscription.types.js';
import { decrypt, encrypt, hashEndpoint } from '../push.crypto.js';

const MAX_DEVICES_PER_USER = 10;

export interface StoredSubscription {
  id: string;
  userId: string;
  subscription: WebPushSubscription;
  expiresAt: Date | null;
}

const unwrap = (row: LeanPushSubscription): StoredSubscription => ({
  id: row._id.toString(),
  userId: row.userId.toString(),
  subscription: JSON.parse(decrypt(row.encryptedSubscription)) as WebPushSubscription,
  expiresAt: row.expiresAt,
});

export class PushSubscriptionsService {
  /** Upsert by endpoint: the same browser subscribing again just refreshes its row. */
  async save(userId: string, input: CreateSubscriptionDto, userAgent: string | undefined): Promise<void> {
    const subscription: WebPushSubscription = { endpoint: input.endpoint, keys: input.keys };
    await PushSubscriptionModel.updateOne(
      { endpointHash: hashEndpoint(input.endpoint) },
      {
        $set: {
          userId,
          encryptedSubscription: encrypt(JSON.stringify(subscription)),
          expiresAt: input.expirationTime ? new Date(input.expirationTime) : null,
          userAgent: userAgent?.slice(0, 300) ?? null,
          failureCount: 0,
        },
      },
      { upsert: true },
    );

    // Keep only the newest N devices per user.
    const extra = await PushSubscriptionModel.find({ userId })
      .sort({ updatedAt: -1 })
      .skip(MAX_DEVICES_PER_USER)
      .select('_id')
      .lean();
    if (extra.length > 0) await PushSubscriptionModel.deleteMany({ _id: { $in: extra.map((row) => row._id) } });
  }

  /** Only the owner can remove their subscription. */
  async remove(userId: string, endpoint: string): Promise<boolean> {
    const result = await PushSubscriptionModel.deleteOne({ userId, endpointHash: hashEndpoint(endpoint) });
    return result.deletedCount > 0;
  }

  async listForUser(userId: string): Promise<StoredSubscription[]> {
    const rows = await PushSubscriptionModel.find({ userId }).lean<LeanPushSubscription[]>();
    return rows.map(unwrap);
  }

  async findById(id: string): Promise<StoredSubscription | null> {
    const row = await PushSubscriptionModel.findById(id).lean<LeanPushSubscription>();
    return row ? unwrap(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    await PushSubscriptionModel.deleteOne({ _id: id });
  }

  async markSuccess(id: string): Promise<void> {
    await PushSubscriptionModel.updateOne({ _id: id }, { $set: { lastSuccessAt: new Date(), failureCount: 0 } });
  }

  async markFailure(id: string): Promise<void> {
    await PushSubscriptionModel.updateOne({ _id: id }, { $inc: { failureCount: 1 } });
  }
}
