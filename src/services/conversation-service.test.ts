import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../lib/http-error.js';
import { Conversation } from '../models/conversation.js';
import { connectTestDatabase } from '../test-support/database-fixture.js';
import {
  getConversationForRequester,
  getOrCreateSupportConversation,
  listConversationsForRequester,
} from './conversation-service.js';

let db: Awaited<ReturnType<typeof connectTestDatabase>>;

describe('conversation-service', () => {
  beforeAll(async () => {
    db = await connectTestDatabase();
    if (!db.connected) {
      // eslint-disable-next-line no-console
      console.warn('[conversation-service.test] Skipping: no MongoDB reachable. Start MongoDB to run these integration tests.');
    }
  }, 15_000);

  afterEach(async () => {
    if (db.connected) await db.reset();
  });

  afterAll(async () => {
    await db.disconnect();
  });

  it('lets the owning customer read their own conversation', async () => {
    if (!db.connected) return;
    const customerId = new Types.ObjectId().toString();
    const conversation = await Conversation.create({ customerId });

    const result = await getConversationForRequester(conversation._id.toString(), { id: customerId, role: 'user' });

    expect(result._id.toString()).toBe(conversation._id.toString());
  });

  it('lets any admin read any conversation', async () => {
    if (!db.connected) return;
    const customerId = new Types.ObjectId().toString();
    const adminId = new Types.ObjectId().toString();
    const conversation = await Conversation.create({ customerId });

    const result = await getConversationForRequester(conversation._id.toString(), { id: adminId, role: 'admin' });

    expect(result._id.toString()).toBe(conversation._id.toString());
  });

  it('throws a 404 (not a 403) when a different customer requests the conversation', async () => {
    if (!db.connected) return;
    const customerId = new Types.ObjectId().toString();
    const outsider = new Types.ObjectId().toString();
    const conversation = await Conversation.create({ customerId });

    await expect(getConversationForRequester(conversation._id.toString(), { id: outsider, role: 'user' })).rejects.toMatchObject(
      { statusCode: 404, code: 'CONVERSATION_NOT_FOUND' } satisfies Partial<HttpError>,
    );
  });

  it('throws a 404 for a malformed conversation id instead of a database error', async () => {
    if (!db.connected) return;
    await expect(
      getConversationForRequester('not-an-object-id', { id: new Types.ObjectId().toString(), role: 'user' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' } satisfies Partial<HttpError>);
  });

  it('reuses the customer’s existing conversation instead of creating a duplicate', async () => {
    if (!db.connected) return;
    const customerId = new Types.ObjectId().toString();

    const first = await getOrCreateSupportConversation(customerId);
    const second = await getOrCreateSupportConversation(customerId);

    expect(second._id.toString()).toBe(first._id.toString());
    await expect(Conversation.countDocuments()).resolves.toBe(1);
  });

  it('lists only the customer’s own conversation for a customer, and every conversation for an admin', async () => {
    if (!db.connected) return;
    const customerA = new Types.ObjectId().toString();
    const customerB = new Types.ObjectId().toString();
    await Conversation.create({ customerId: customerA });
    await Conversation.create({ customerId: customerB });

    const customerView = await listConversationsForRequester({ role: 'user', userId: customerA });
    expect(customerView).toHaveLength(1);
    expect((customerView[0]?.customerId as { _id: Types.ObjectId })._id.toString()).toBe(customerA);

    const adminView = await listConversationsForRequester({ role: 'admin', userId: new Types.ObjectId().toString() });
    expect(adminView).toHaveLength(2);
  });
});
