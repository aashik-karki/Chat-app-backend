# Real-time events (Socket.IO)

The frontend's contract with the server. REST endpoints are in Swagger at `/api/docs`.

## Connecting

```ts
import { io } from 'socket.io-client';

const socket = io(API_URL, {
  withCredentials: true, // sends the HttpOnly `chat.sid` session cookie — log in over REST first
  transports: ['websocket'],
});
```

- No token: the socket is authenticated by the same session cookie as REST. Not logged in → `connect_error` with message `AUTHENTICATION_REQUIRED`.
- **Connection state recovery:** after a short drop (< 2 min) Socket.IO reconnects automatically, restores rooms and replays missed events. Check `socket.recovered` in the `connect` handler; if `false`, re-fetch state over REST.
- On connect the server automatically joins you to: your personal room, the staff room (admins/agents), and — for customers — **your own conversation** (you don't need to emit `conversation:join`).

## Acks

Every client event can take an ack callback. The response is always:

```ts
type Ack<T> = { ok: true; data?: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const res = await socket.timeout(5000).emitWithAck('message:send', { conversationId, clientId, text });
if (!res.ok) showError(res.error.code);
```

Common error codes: `INVALID_PAYLOAD`, `RATE_LIMITED`, `CONVERSATION_NOT_FOUND`, `FORBIDDEN`, `NOT_IN_CONVERSATION`, `TOO_MANY_CONVERSATIONS`, `INTERNAL_ERROR`.

## Client → server

| Event | Payload | Ack `data` | Who | Notes |
|---|---|---|---|---|
| `conversation:join` | `{ conversationId }` | `{ conversationId }` | staff (customers auto-join) | Joins the room; marks the other side's messages as delivered. Max 50 open at once. |
| `conversation:leave` | `{ conversationId }` | – | anyone | Call when closing a chat view. |
| `message:send` | `{ conversationId, clientId, text }` | `Message` | anyone with access | `clientId` = `crypto.randomUUID()` made by the client; **reuse it when retrying** — the server never stores a duplicate. Max 4000 chars. Limit: 20 per 10s. |
| `message:read` | `{ conversationId, lastMessageId }` | – | anyone in the room | "I've seen everything up to this message." Send when the newest message is visible. |
| `typing:set` | `{ conversationId, isTyping }` | – | anyone in the room | Send `true` at most every ~2s while typing (throttle), `false` when input is cleared/sent. The server clears it by itself after 6s without a `true`. |
| `presence:subscribe` | `{ userIds: string[] }` (≤ 200) | `{ [userId]: { online, lastSeen } }` | anyone | Replaces your watch list; changes arrive as `presence:update`. |
| `agent:set-status` | `{ availability: 'online' \| 'busy' \| 'offline' }` | `AgentStatus` | agents | `busy` = keep current chats, get no new ones. |
| `metrics:subscribe` | `{}` | `MetricsUpdate` | admins | Then `metrics:update` every 5s. |
| `metrics:unsubscribe` | `{}` | – | admins | |

## Server → client

| Event | Payload | Sent to |
|---|---|---|
| `message:new` | `Message` | the conversation room (not the sender's own socket — use the ack for that) |
| `message:status` | `{ conversationId, messageId, status: 'delivered' \| 'read', at }` | the conversation room. For `read`, `messageId` is the newest read message: treat every earlier message from you as read too. |
| `typing:update` | `{ conversationId, userId, name, isTyping }` | the conversation room |
| `presence:update` | `{ userId, online, lastSeen }` | watchers of that user + all staff |
| `conversation:updated` | `{ conversationId, unreadCount, lastMessagePreview?, lastMessageAt? }` | the side whose unread count changed (customer, or all staff). **`unreadCount` is computed by the server — just display it.** |
| `conversation:assigned` | `{ conversationId, agentId, agentName, status: 'open' \| 'closed', reason }` | staff, the customer, and the conversation room. `reason`: `auto`, `claim`, `manual`, `requeue`, `closed`. If `agentId` is you, open/join that chat. |
| `agent:status` | `AgentStatus` | all staff dashboards |
| `metrics:update` | `MetricsUpdate` | admins who subscribed |

## Types

```ts
interface Message {
  id: string;
  clientMessageId: string; // your clientId — match it to replace the optimistic message
  conversationId: string;
  senderId: string;
  text: string;
  status: 'sent' | 'delivered' | 'read'; // only ever moves forward
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

interface AgentStatus {
  agentId: string;
  name: string;
  email: string;
  availability: 'online' | 'busy' | 'offline'; // what the agent chose
  connected: boolean;                            // has a live socket
  status: 'online' | 'busy' | 'offline';       // show THIS one (offline if not connected)
  activeChats: number;
  maxConcurrentChats: number;
  skills: string[];
  lastSeen: string | null;
}

interface MetricsUpdate {
  snapshot: {
    timestamp: string;
    activeUsers: number;
    agents: { online: number; busy: number; offline: number };
    conversations: { open: number; waitingInQueue: number };
    messages: { lastMinute: number; lastHour: number; today: number };
    push: { sent: number; failed: number; expired: number };
    connectionsOnThisServer: number;
  };
  messagesPerMinute: Array<{ minute: string; messages: number }>; // last 60, oldest first
}
```

## Recommended client flow

1. `GET /api/v1/auth/csrf-token` → `POST /auth/login` (keep the new `csrfToken`) → connect the socket.
2. Customer: `GET /conversations/mine` + `GET /conversations/:id/messages`. Staff: `GET /conversations` (+ `GET /agents`, `GET /agents/queue`).
3. Send: add the message to the UI immediately with `status: 'sending'` and a `clientId`; on ack replace it with `data`; on failure show "retry" and resend **with the same `clientId`**.
4. On reconnect with `socket.recovered === false`, re-fetch the open conversation's first page and the conversation list.

## Web Push

1. `GET /api/v1/push/public-key` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
2. `POST /api/v1/push/subscriptions` with `subscription.toJSON()`; `DELETE` the same on logout.
3. The service worker receives JSON: `{ type: 'message', title, body, conversationId, messageId, url, tag }`. Show it with `tag` (so one chat = one notification) and open `url` on click.

The server only pushes when the recipient is **not** looking at that conversation, and retries failed deliveries with backoff.
