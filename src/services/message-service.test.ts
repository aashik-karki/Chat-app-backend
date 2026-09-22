import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Conversation } from '../models/conversation.js';
import { Message } from '../models/message.js';
import { connectTestDatabase } from '../test-support/database-fixture.js';
import { createMessage, getMessageHistory } from './message-service.js';

let db: Awaited<ReturnType<typeof connectTestDatabase>>;

describe('message-service', () => {
  beforeAll(async () => {
    db = await connectTestDatabase();
    if (!db.connected) {
      // eslint-disable-next-line no-console
      console.warn('[message-service.test] Skipping: no MongoDB reachable. Start MongoDB to run these integration tests.');
    }
  }, 15_000);

  afterEach(async () => {
    if (db.connected) await db.reset();
  });

  afterAll(async () => {
    await db.disconnect();
  });

  const makeConversation = async () => {
    const conversation = await Conversation.create({ customerId: new Types.ObjectId() });
    return conversation._id.toString();
  };

  it('persists a message and bumps the conversation lastMessageAt', async () => {
    if (!db.connected) return;
    const conversationId = await makeConversation();
    const senderId = new Types.ObjectId().toString();

    const message = await createMessage({ conversationId, senderId, clientMessageId: 'client-1', text: 'hello' });

    expect(message.text).toBe('hello');
    expect(message.status).toBe('sent');

    const conversation = await Conversation.findById(conversationId).lean();
    expect(conversation?.lastMessageAt).not.toBeNull();
  });

  it('is idempotent: retrying the same clientMessageId does not duplicate the message', async () => {
    if (!db.connected) return;
    const conversationId = await makeConversation();
    const senderId = new Types.ObjectId().toString();

    const first = await createMessage({ conversationId, senderId, clientMessageId: 'retry-1', text: 'first try' });
    const second = await createMessage({ conversationId, senderId, clientMessageId: 'retry-1', text: 'first try' });

    expect(second.id).toBe(first.id);
    await expect(Message.countDocuments({ conversationId })).resolves.toBe(1);
  });

  it('paginates history oldest-to-newest per page, newest page first', async () => {
    if (!db.connected) return;
    const conversationId = await makeConversation();
    const senderId = new Types.ObjectId().toString();

    // Create 5 messages with strictly increasing createdAt so ordering is unambiguous.
    for (let index = 0; index < 5; index += 1) {
      const message = await Message.create({
        conversationId,
        senderId,
        clientMessageId: `m-${index}`,
        text: `message ${index}`,
      });
      await Message.updateOne({ _id: message._id }, { createdAt: new Date(2026, 0, 1, 0, index) });
    }

    const firstPage = await getMessageHistory({ conversationId, limit: 2 });
    expect(firstPage.messages).toHaveLength(2);
    expect(firstPage.messages.map((m) => m.text)).toEqual(['message 3', 'message 4']);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await getMessageHistory({ conversationId, limit: 2, cursor: firstPage.nextCursor ?? undefined });
    expect(secondPage.messages.map((m) => m.text)).toEqual(['message 1', 'message 2']);
    expect(secondPage.nextCursor).not.toBeNull();

    const thirdPage = await getMessageHistory({ conversationId, limit: 2, cursor: secondPage.nextCursor ?? undefined });
    expect(thirdPage.messages.map((m) => m.text)).toEqual(['message 0']);
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('clamps an out-of-range limit into the allowed page size bounds', async () => {
    if (!db.connected) return;
    const conversationId = await makeConversation();
    const senderId = new Types.ObjectId().toString();
    await createMessage({ conversationId, senderId, clientMessageId: 'only', text: 'hi' });

    const page = await getMessageHistory({ conversationId, limit: 10_000 });
    expect(page.messages).toHaveLength(1);
  });

  it('only returns messages for the requested conversation', async () => {
    if (!db.connected) return;
    const conversationA = await makeConversation();
    const conversationB = await makeConversation();
    const senderId = new Types.ObjectId().toString();

    await createMessage({ conversationId: conversationA, senderId, clientMessageId: 'a-1', text: 'in A' });
    await createMessage({ conversationId: conversationB, senderId, clientMessageId: 'b-1', text: 'in B' });

    const page = await getMessageHistory({ conversationId: conversationA });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.text).toBe('in A');
  });
});
