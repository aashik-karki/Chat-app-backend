import { hasPermission } from '../../common/auth/permissions.js';
import { HttpError } from '../../common/errors/http-error.js';
import { logger } from '../../core/logger.js';
import { rooms } from '../../realtime/rooms.js';
import { onEvent } from '../../realtime/socket-handler.js';
import type { AppServer, AppSocket, Gateway, SocketUser } from '../../realtime/socket.types.js';
import { otherSide, sideOf, type ChatSide, type ConversationRef } from './chat-side.js';
import { conversationRefDto } from './dto/socket/conversation-ref.dto.js';
import { readMessagesDto } from './dto/socket/read-messages.dto.js';
import { sendMessageDto } from './dto/socket/send-message.dto.js';
import { typingDto } from './dto/socket/typing.dto.js';
import { toConversationRef, type ConversationsService } from './services/conversations.service.js';
import type { MessagesService } from './services/messages.service.js';

/** If a client stops sending typing:true (tab closed, crash), clear the indicator after this long. */
const TYPING_TIMEOUT_MS = 6_000;
/** Staff dashboards can open many threads; stop a single socket from joining thousands of rooms. */
const MAX_CONVERSATION_ROOMS = 50;

export type MessageCreatedListener = (event: {
  conversation: ConversationRef;
  message: import('./chat.mapper.js').MessageResponse;
  sender: SocketUser;
  recipientOnline: boolean;
}) => void;

/**
 * Client → server events (all acks are `{ ok: true, data? } | { ok: false, error: { code, message } }`):
 *   conversation:join  { conversationId }                 → ack data: { conversationId }
 *   conversation:leave { conversationId }
 *   message:send       { conversationId, clientId, text } → ack data: MessageResponse
 *   message:read       { conversationId, lastMessageId }
 *   typing:set         { conversationId, isTyping }
 *
 * Server → client events: message:new, message:status, typing:update, conversation:updated
 */
/** Runs before a staff member's message is saved; throw to block it (e.g. chat belongs to another agent). */
export type StaffReplyGuard = (conversationId: string, staff: SocketUser) => Promise<void>;

export class ChatGateway implements Gateway {
  private messageListeners: MessageCreatedListener[] = [];
  private staffReplyGuard: StaffReplyGuard | null = null;

  constructor(
    private readonly io: AppServer,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  /** Lets other modules (agents, push notifications) react to new messages. */
  onMessageCreated(listener: MessageCreatedListener) {
    this.messageListeners.push(listener);
  }

  /** Set by the agents module: who on the staff side may reply in a thread. */
  setStaffReplyGuard(guard: StaffReplyGuard) {
    this.staffReplyGuard = guard;
  }

  onConnection(socket: AppSocket) {
    const { user } = socket.data;
    const typingTimers = new Map<string, NodeJS.Timeout>();

    // A customer has exactly one thread: put them in its room straight away.
    // Handlers below are registered synchronously and `await ready` before
    // relying on room membership (see Gateway docs for why).
    const ready =
      user.role === 'user'
        ? this.conversations
            .getOrCreateForCustomer(user.id)
            .then((conversation) => this.enterConversation(socket, toConversationRef(conversation)))
            .catch((error) => logger.error({ error, userId: user.id }, 'Could not join own conversation on connect'))
        : Promise.resolve();

    onEvent(socket, 'conversation:join', conversationRefDto, async ({ conversationId }) => {
      await ready;
      const joined = [...socket.rooms].filter(rooms.isConversation);
      if (!joined.includes(rooms.conversation(conversationId)) && joined.length >= MAX_CONVERSATION_ROOMS) {
        throw new HttpError(429, 'TOO_MANY_CONVERSATIONS', `Leave a conversation first (max ${MAX_CONVERSATION_ROOMS})`);
      }
      const conversation = await this.conversations.getForRequester(conversationId, user);
      await this.enterConversation(socket, toConversationRef(conversation));
      return { conversationId };
    });

    onEvent(socket, 'conversation:leave', conversationRefDto, async ({ conversationId }) => {
      await ready;
      this.stopTyping(socket, conversationId, typingTimers);
      await socket.leave(rooms.conversation(conversationId));
    });

    onEvent(
      socket,
      'message:send',
      sendMessageDto,
      async ({ conversationId, clientId, text }) => {
        await ready;
        // Access is re-checked on every send; room membership alone is not trusted.
        const conversation = toConversationRef(await this.conversations.getForRequester(conversationId, user));
        const side = sideOf(conversation, user.id);
        if (!hasPermission(user.role, side === 'customer' ? 'chat:send_own' : 'chat:reply')) {
          throw HttpError.forbidden('You cannot send messages in this conversation');
        }
        if (side === 'staff' && this.staffReplyGuard) await this.staffReplyGuard(conversationId, user);

        const { message: saved, created } = await this.messages.create({
          conversationId,
          senderId: user.id,
          clientMessageId: clientId,
          text,
        });
        // A retry of an already-saved message: just ack it again, don't re-broadcast.
        if (!created) return saved;

        this.stopTyping(socket, conversationId, typingTimers);

        // If someone from the other side has this thread open, it's delivered now.
        const recipientOnline = await this.isSideInRoom(conversation, otherSide(side));
        const message = recipientOnline ? ((await this.messages.markDelivered(saved.id)) ?? saved) : saved;

        socket.to(rooms.conversation(conversationId)).emit('message:new', message);
        await this.publishConversationUpdate(conversation, otherSide(side), message.text, message.createdAt);

        for (const listener of this.messageListeners) {
          try {
            listener({ conversation, message, sender: user, recipientOnline });
          } catch (error) {
            logger.warn({ error }, 'message listener failed');
          }
        }
        return message;
      },
      { rateLimit: { max: 20, windowMs: 10_000 } },
    );

    onEvent(
      socket,
      'message:read',
      readMessagesDto,
      async ({ conversationId, lastMessageId }) => {
        await ready;
        if (!socket.rooms.has(rooms.conversation(conversationId))) {
          throw new HttpError(409, 'NOT_IN_CONVERSATION', 'Join the conversation first');
        }
        const conversation = toConversationRef(await this.conversations.getForRequester(conversationId, user));
        const side = sideOf(conversation, user.id);

        const result = await this.messages.markRead(conversation, side, lastMessageId);
        if (!result || result.updatedCount === 0) return; // nothing new → nothing to broadcast

        // The receipt goes on the newest read message (how chat UIs show it).
        this.io.to(rooms.conversation(conversationId)).emit('message:status', {
          conversationId,
          messageId: lastMessageId,
          status: 'read',
          at: result.readAt,
        });
        // Every tab/dashboard on the reader's side gets the new unread count.
        await this.publishConversationUpdate(conversation, side);
      },
      { rateLimit: { max: 30, windowMs: 10_000 } },
    );

    onEvent(
      socket,
      'typing:set',
      typingDto,
      async ({ conversationId, isTyping }) => {
        await ready;
        if (!socket.rooms.has(rooms.conversation(conversationId))) return;
        if (!isTyping) return this.stopTyping(socket, conversationId, typingTimers);

        const wasTyping = typingTimers.has(conversationId);
        clearTimeout(typingTimers.get(conversationId));
        typingTimers.set(
          conversationId,
          setTimeout(() => this.stopTyping(socket, conversationId, typingTimers), TYPING_TIMEOUT_MS),
        );
        // Only the START is broadcast; keep-alive pings just extend the timer (saves traffic).
        if (!wasTyping) {
          socket.to(rooms.conversation(conversationId)).emit('typing:update', {
            conversationId,
            userId: user.id,
            name: user.name,
            isTyping: true,
          });
        }
      },
      { rateLimit: { max: 30, windowMs: 10_000 } },
    );

    // 'disconnecting' still has socket.rooms filled in; 'disconnect' does not.
    socket.on('disconnecting', () => {
      for (const conversationId of [...typingTimers.keys()]) this.stopTyping(socket, conversationId, typingTimers);
    });
  }

  /** Join the room and mark everything the other side sent as delivered. */
  private async enterConversation(socket: AppSocket, conversation: ConversationRef) {
    await socket.join(rooms.conversation(conversation.id));
    const side = sideOf(conversation, socket.data.user.id);
    const delivered = await this.messages.markDeliveredTo(conversation, side);
    for (const message of delivered) {
      this.io.to(rooms.conversation(conversation.id)).emit('message:status', {
        conversationId: conversation.id,
        messageId: message.id,
        status: 'delivered',
        at: message.deliveredAt ?? new Date().toISOString(),
      });
    }
  }

  private stopTyping(socket: AppSocket, conversationId: string, timers: Map<string, NodeJS.Timeout>) {
    const timer = timers.get(conversationId);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(conversationId);
    socket.to(rooms.conversation(conversationId)).emit('typing:update', {
      conversationId,
      userId: socket.data.user.id,
      name: socket.data.user.name,
      isTyping: false,
    });
  }

  /** Is any socket from `side` currently in this conversation's room (on any server)? */
  private async isSideInRoom(conversation: ConversationRef, side: ChatSide): Promise<boolean> {
    const sockets = await this.io.in(rooms.conversation(conversation.id)).fetchSockets();
    return sockets.some((socket) => sideOf(conversation, socket.data.user.id) === side);
  }

  /** Server-computed unread count (+ preview on new messages) for every screen on one side. */
  private async publishConversationUpdate(conversation: ConversationRef, side: ChatSide, preview?: string, at?: string) {
    const unread = await this.messages.getUnreadCounts([conversation], side);
    const target = side === 'staff' ? rooms.staff : rooms.user(conversation.customerId);
    this.io.to(target).emit('conversation:updated', {
      conversationId: conversation.id,
      unreadCount: unread[conversation.id] ?? 0,
      ...(preview !== undefined ? { lastMessagePreview: preview.slice(0, 200) } : {}),
      ...(at !== undefined ? { lastMessageAt: at } : {}),
    });
  }
}
