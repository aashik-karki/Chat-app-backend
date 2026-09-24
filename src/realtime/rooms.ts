/**
 * Every Socket.IO room name in one place, so no gateway builds room strings by hand.
 *   user:{id}          → all tabs/devices of one user (auto-joined on connect)
 *   staff              → every admin/agent socket (auto-joined on connect)
 *   conversation:{id}  → sockets currently viewing one support thread
 *   presence:{id}      → sockets that asked for live presence of that user
 */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  staff: 'staff',
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  presence: (userId: string) => `presence:${userId}`,
  isConversation: (room: string) => room.startsWith('conversation:'),
} as const;
