import { hasPermission } from '../../common/auth/permissions.js';
import { HttpError } from '../../common/errors/http-error.js';
import { onEvent } from '../../realtime/socket-handler.js';
import type { AppSocket, Gateway } from '../../realtime/socket.types.js';
import { setAvailabilityDto } from './dto/set-availability.dto.js';
import type { AgentsService } from './services/agents.service.js';

/**
 * Client events:
 *   agent:set-status { availability: 'online' | 'busy' | 'offline' } → ack data: AgentStatusResponse
 * Server events (to the staff room): agent:status, conversation:assigned
 */
export class AgentsGateway implements Gateway {
  constructor(private readonly agents: AgentsService) {}

  onConnection(socket: AppSocket) {
    const { user } = socket.data;
    onEvent(
      socket,
      'agent:set-status',
      setAvailabilityDto,
      async ({ availability }) => {
        if (!hasPermission(user.role, 'agent:set_status')) throw HttpError.forbidden('Only agents have a status');
        return this.agents.setAvailability(user.id, availability);
      },
      { rateLimit: { max: 10, windowMs: 10_000 } },
    );
  }
}
