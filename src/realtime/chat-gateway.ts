import { Types } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { logger } from '../lib/logger.js';
import {
  getConversationForRequester,
  getOrCreateSupportConversation,
} from '../services/conversation-service.js';
import {
  createMessage,
  markMessageDelivered,
  markMessagesDeliveredOnJoin,
  markMessagesRead,
} from '../services/message-service.js';
import { presenceStore } from './presence-store.js';
import { type AuthenticatedSocketUser, getSocketUser } from './socket-auth.js';

const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

interface JoinPayload {
  conversationId?: string;
}

interface SendMessagePayload {
  clientId?: string;
  conversationId?: string;
  text?: string;
}

interface TypingPayload {
  conversationId?: string;
  isTyping?: boolean;
}

interface ReadPayload {
  conversationId?: string;
  lastMessageId?: string;
}

type SendAck = (response: Record<string, unknown>) => void;

/**
 * Wires up every chat-related socket event. Call once per Socket.IO server,
 * after `attachSocketAuth` has run so `socket.data.user` is populated.
 */
export const registerChatGateway = (io: Server) => {
  io.on('connection', (socket) => {
    const user = getSocketUser(socket);
    logger.info({ socketId: socket.id, userId: user.id }, 'Socket connected');

    void handleConnect(socket, user);

    socket.on('conversation:join', (payload: JoinPayload) => {
      void handleJoin(io, socket, user, payload);
    });

    socket.on('message:send', (payload: SendMessagePayload, ack?: SendAck) => {
      void handleSend(io, socket, user, payload, ack);
    });

    socket.on('typing:set', (payload: TypingPayload) => {
      handleTyping(socket, user, payload);
    });

    socket.on('message:read', (payload: ReadPayload) => {
      void handleRead(socket, user, payload);
    });

    // Web Push registration is a separate, not-yet-built feature (see the
    // original spec) — accept the event quietly rather than leaving the
    // client's emit to look like it vanished into nothing.
    socket.on('push:subscribe', () => {
      logger.info({ userId: user.id }, 'push:subscribe received (Web Push not implemented yet)');
    });

    // 'disconnecting' fires before Socket.IO removes the socket from its
    // rooms, so this is the last point `socket.rooms` is still accurate.
    socket.on('disconnecting', () => {
      handleDisconnecting(socket, user);
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId: user.id, reason }, 'Socket disconnected');
    });

    socket.on('error', (error) => logger.error({ socketId: socket.id, userId: user.id, error }, 'Socket error'));
  });
};

/**
 * A customer only ever has one conversation (the support-desk model), so
 * they're placed in its room immediately rather than waiting for an
 * explicit join — that room is also how their presence updates reach
 * whichever admin is currently viewing them.
 */
const handleConnect = async (socket: Socket, user: AuthenticatedSocketUser) => {
  const justCameOnline = presenceStore.connect(user.id, socket.id);

  if (user.role !== 'user') return;
  try {
    const conversation = await getOrCreateSupportConversation(user.id);
    const room = conversationRoom(conversation._id.toString());
    await socket.join(room);
    if (justCameOnline) {
      socket.to(room).emit('presence:update', { userId: user.id, presence: 'online' });
    }
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Failed to join own support conversation on connect');
  }
};

const handleJoin = async (io: Server, socket: Socket, user: AuthenticatedSocketUser, payload: JoinPayload) => {
  const conversationId = payload?.conversationId;
  if (!conversationId || !Types.ObjectId.isValid(conversationId)) return;

  try {
    const conversation = await getConversationForRequester(conversationId, { id: user.id, role: user.role });
    const room = conversationRoom(conversation._id.toString());
    await socket.join(room);

    // Tell the joiner the thread's current presence right away rather than
    // waiting for the next change — the other side may already be online.
    const customerId = conversation.customerId.toString();
    if (customerId !== user.id) {
      socket.emit('presence:update', {
        userId: customerId,
        presence: presenceStore.isOnline(customerId) ? 'online' : 'offline',
        lastSeen: presenceStore.getLastSeen(customerId),
      });
    }
    if (user.role === 'admin') {
      socket.to(room).emit('presence:update', { userId: user.id, presence: 'online' });
    }

    // Anything the other side sent while this socket wasn't in the room is
    // now on screen, so it counts as delivered.
    const delivered = await markMessagesDeliveredOnJoin(conversationId, user.id);
    delivered.forEach((message) => {
      socket.to(room).emit('message:status', {
        conversationId,
        messageId: message.id,
        status: 'delivered',
        at: message.deliveredAt,
      });
    });
  } catch (error) {
    logger.warn({ error, conversationId, userId: user.id }, 'conversation:join rejected');
  }
};

const handleSend = async (
  io: Server,
  socket: Socket,
  user: AuthenticatedSocketUser,
  payload: SendMessagePayload,
  ack?: SendAck,
) => {
  const respond: SendAck = typeof ack === 'function' ? ack : () => undefined;
  const conversationId = payload?.conversationId;
  const text = payload?.text?.trim();
  const clientId = payload?.clientId;

  if (!conversationId || !text || !clientId) {
    respond({ status: 'failed', error: 'INVALID_PAYLOAD' });
    return;
  }

  try {
    // Re-checked on every send, not just at join time — stale room
    // membership from an earlier session shouldn't carry authority.
    const conversation = await getConversationForRequester(conversationId, { id: user.id, role: user.role });
    const room = conversationRoom(conversation._id.toString());

    let message = await createMessage({ conversationId, senderId: user.id, clientMessageId: clientId, text });

    // If the other side is already in the room, the message lands on their
    // screen immediately, so it's delivered rather than merely sent.
    const recipientSockets = await io.in(room).except(socket.id).fetchSockets();
    if (recipientSockets.length > 0 && message.status === 'sent') {
      const delivered = await markMessageDelivered(message.id);
      if (delivered) message = delivered;
    }

    socket.to(room).emit('message:new', {
      id: message.id,
      clientId: message.clientMessageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      text: message.text,
      createdAt: message.createdAt,
      status: message.status,
      deliveredAt: message.deliveredAt ?? undefined,
      readAt: message.readAt ?? undefined,
    });

    respond({
      id: message.id,
      createdAt: message.createdAt,
      status: message.status,
      deliveredAt: message.deliveredAt ?? undefined,
    });
  } catch (error) {
    logger.error({ error, userId: user.id, conversationId }, 'message:send failed');
    respond({ status: 'failed', error: 'SEND_FAILED' });
  }
};

const handleTyping = (socket: Socket, user: AuthenticatedSocketUser, payload: TypingPayload) => {
  const conversationId = payload?.conversationId;
  if (!conversationId) return;

  // Only broadcast into rooms this socket has actually (and, by extension,
  // was authorized to) join — cheap enough to check on every keystroke burst.
  const room = conversationRoom(conversationId);
  if (!socket.rooms.has(room)) return;

  socket.to(room).emit('typing:update', { conversationId, userId: user.id, isTyping: Boolean(payload.isTyping) });
};

const handleRead = async (socket: Socket, user: AuthenticatedSocketUser, payload: ReadPayload) => {
  const conversationId = payload?.conversationId;
  const lastMessageId = payload?.lastMessageId;
  if (!conversationId || !lastMessageId) return;

  const room = conversationRoom(conversationId);
  if (!socket.rooms.has(room)) return;

  try {
    const result = await markMessagesRead({ conversationId, readerId: user.id, throughMessageId: lastMessageId });
    if (!result) return;

    // Only the latest read message is reported back — chat UIs conventionally
    // show the read receipt on the newest read message, not each one.
    socket.to(room).emit('message:status', {
      conversationId,
      messageId: lastMessageId,
      status: 'read',
      at: result.readAt,
    });
  } catch (error) {
    logger.warn({ error, conversationId, userId: user.id }, 'message:read failed');
  }
};

const handleDisconnecting = (socket: Socket, user: AuthenticatedSocketUser) => {
  const justWentOffline = presenceStore.disconnect(user.id, socket.id);
  if (!justWentOffline) return;

  const lastSeen = presenceStore.getLastSeen(user.id);
  socket.rooms.forEach((room) => {
    if (room === socket.id) return; // every socket's own private room; not a conversation
    socket.to(room).emit('presence:update', { userId: user.id, presence: 'offline', lastSeen });
  });
};
