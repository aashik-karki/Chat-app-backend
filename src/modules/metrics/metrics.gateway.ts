import { z } from 'zod';
import { hasPermission } from '../../common/auth/permissions.js';
import { HttpError } from '../../common/errors/http-error.js';
import { rooms } from '../../realtime/rooms.js';
import { onEvent } from '../../realtime/socket-handler.js';
import type { AppSocket, Gateway } from '../../realtime/socket.types.js';
import type { MetricsService } from './metrics.service.js';

const noPayload = z.unknown();

/**
 * Client events (admins only):
 *   metrics:subscribe   → ack data: MetricsUpdate, then `metrics:update` every 5s
 *   metrics:unsubscribe
 */
export class MetricsGateway implements Gateway {
  constructor(private readonly metrics: MetricsService) {}

  onConnection(socket: AppSocket) {
    const { user } = socket.data;
    onEvent(
      socket,
      'metrics:subscribe',
      noPayload,
      async () => {
        if (!hasPermission(user.role, 'metrics:view')) throw HttpError.forbidden('Metrics are for admins');
        await socket.join(rooms.metrics);
        return this.metrics.update();
      },
      { rateLimit: { max: 5, windowMs: 10_000 } },
    );
    onEvent(socket, 'metrics:unsubscribe', noPayload, async () => {
      await socket.leave(rooms.metrics);
    });
  }
}
