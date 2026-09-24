import { logger } from '../../core/logger.js';
import { rooms } from '../../realtime/rooms.js';
import { onEvent } from '../../realtime/socket-handler.js';
import type { AppSocket, Gateway } from '../../realtime/socket.types.js';
import { presenceSubscribeDto } from './dto/presence-subscribe.dto.js';
import type { PresenceService } from './presence.service.js';

/**
 * Client events:
 *   presence:subscribe { userIds } → ack { ok, data: { [userId]: { online, lastSeen } } }
 *     Watch these users; later changes arrive as `presence:update`.
 */
export class PresenceGateway implements Gateway {
  constructor(private readonly presence: PresenceService) {}

  onConnection(socket: AppSocket) {
    const { user } = socket.data;

    // Handlers first (see Gateway docs), async work after.
    onEvent(
      socket,
      'presence:subscribe',
      presenceSubscribeDto,
      async ({ userIds }) => {
        const watching = [...socket.rooms].filter((room) => room.startsWith('presence:'));
        await Promise.all(watching.map((room) => socket.leave(room)));
        await socket.join(userIds.map(rooms.presence));
        return this.presence.snapshot(userIds);
      },
      { rateLimit: { max: 10, windowMs: 10_000 } },
    );

    const registered = this.presence
      .socketConnected(user.id, socket.id)
      .catch((error) => logger.warn({ error, userId: user.id }, 'Presence connect failed'));

    // Wait for the connect to finish, so a very fast disconnect can't be applied before it.
    socket.on('disconnect', () => {
      void registered.then(() =>
        this.presence
          .socketDisconnected(user.id, socket.id)
          .catch((error) => logger.warn({ error, userId: user.id }, 'Presence disconnect failed')),
      );
    });
  }
}
