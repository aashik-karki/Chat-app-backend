import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../lib/http-error.js';
import { Conversation } from '../models/conversation.js';
import { connectTestDatabase } from '../test-support/database-fixture.js';
import { getConversationForParticipant, getOrCreateDirectConversation } from './conversation-service.js';

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

  it('returns the conversation when the requesting user is a participant', async () => {
    if (!db.connected) return;
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const conversation = await Conversation.create({ participants: [userA, userB] });

    const result = await getConversationForParticipant(conversation._id.toString(), userA);

    expect(result._id.toString()).toBe(conversation._id.toString());
  });

  it('throws a 404 (not a 403) when the user is not a participant', async () => {
    if (!db.connected) return;
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const outsider = new Types.ObjectId().toString();
    const conversation = await Conversation.create({ participants: [userA, userB] });

    await expect(getConversationForParticipant(conversation._id.toString(), outsider)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONVERSATION_NOT_FOUND',
    } satisfies Partial<HttpError>);
  });

  it('throws a 404 for a malformed conversation id instead of a database error', async () => {
    if (!db.connected) return;
    await expect(getConversationForParticipant('not-an-object-id', new Types.ObjectId().toString())).rejects.toMatchObject(
      { statusCode: 404, code: 'CONVERSATION_NOT_FOUND' } satisfies Partial<HttpError>,
    );
  });

  it('reuses an existing direct conversation instead of creating a duplicate', async () => {
    if (!db.connected) return;
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();

    const first = await getOrCreateDirectConversation(userA, userB);
    const second = await getOrCreateDirectConversation(userB, userA);

    expect(second._id.toString()).toBe(first._id.toString());
    await expect(Conversation.countDocuments()).resolves.toBe(1);
  });
});
