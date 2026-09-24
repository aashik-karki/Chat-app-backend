import type { Server, Socket } from 'socket.io';
import type { Role } from '../common/auth/permissions.js';

export interface SocketUser {
  id: string;
  name: string;
  role: Role;
}

export interface SocketData {
  user: SocketUser;
}

/** Every ack the server sends back has this shape. */
export type AckResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export type Ack<T = unknown> = (response: AckResponse<T>) => void;

/** Events the server emits to clients (the typed contract for the frontend). */
export interface ServerToClientEvents {
  'message:new': (payload: import('../modules/chat/chat.mapper.js').MessageResponse) => void;
  'message:status': (payload: { conversationId: string; messageId: string; status: 'delivered' | 'read'; at: string }) => void;
  'typing:update': (payload: { conversationId: string; userId: string; name: string; isTyping: boolean }) => void;
  'presence:update': (payload: { userId: string; online: boolean; lastSeen: string | null }) => void;
  'agent:status': (payload: import('../modules/agents/agents.mapper.js').AgentStatusResponse) => void;
  'conversation:assigned': (payload: {
    conversationId: string;
    agentId: string | null;
    agentName: string | null;
    status: 'open' | 'closed';
    reason: 'auto' | 'claim' | 'manual' | 'requeue' | 'closed';
  }) => void;
  'metrics:update': (payload: import('../modules/metrics/metrics.service.js').MetricsUpdate) => void;
  'conversation:updated': (payload: {
    conversationId: string;
    unreadCount: number;
    lastMessagePreview?: string;
    lastMessageAt?: string;
  }) => void;
}

/** Client → server events are validated with zod at runtime (see socket-handler.ts), so they're loosely typed here. */
export type ClientToServerEvents = Record<string, (payload: unknown, ack?: Ack) => void>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Like a NestJS @WebSocketGateway: gets every new connection.
 *
 * IMPORTANT: register every `socket.on(...)` handler SYNCHRONOUSLY at the top
 * of onConnection, before any `await`. Socket.IO drops events that arrive
 * before a handler exists, and clients usually emit right after connecting.
 * Do async setup afterwards (and let handlers await it if they need it).
 */
export interface Gateway {
  onConnection(socket: AppSocket): void;
}
