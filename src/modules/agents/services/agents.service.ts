import { Types } from 'mongoose';
import { HttpError } from '../../../common/errors/http-error.js';
import { logger } from '../../../core/logger.js';
import { rooms } from '../../../realtime/rooms.js';
import type { AppServer } from '../../../realtime/socket.types.js';
import type { PresenceService } from '../../presence/presence.service.js';
import type { PublicUser } from '../../users/users.mapper.js';
import type { UsersService } from '../../users/users.service.js';
import { toAgentStatus, type AgentStatusResponse } from '../agents.mapper.js';
import type { UpdateAgentSettingsDto } from '../dto/update-agent-settings.dto.js';
import { AgentProfile } from '../models/agent-profile.model.js';
import type { AgentAvailability, LeanAgentProfile } from '../models/agent-profile.types.js';

export interface AgentCandidate {
  user: PublicUser;
  profile: LeanAgentProfile;
}

const DEFAULT_MAX_CHATS = 5;

/** Fills in any missing field (older documents, or stores that drop empty values), so callers never see undefined. */
const normalizeProfile = (profile: Partial<LeanAgentProfile>): LeanAgentProfile => ({
  ...(profile as LeanAgentProfile),
  availability: profile.availability ?? 'offline',
  skills: profile.skills ?? [],
  maxConcurrentChats: profile.maxConcurrentChats ?? DEFAULT_MAX_CHATS,
  activeChats: profile.activeChats ?? 0,
  lastAssignedAt: profile.lastAssignedAt ?? null,
});

type AvailabilityListener = (agentId: string, status: AgentAvailability) => void;

/**
 * Agent profiles, availability and live status for dashboards.
 * Routing decisions live in AssignmentService; this service owns the data.
 */
export class AgentsService {
  private io: AppServer | null = null;
  private listeners: AvailabilityListener[] = [];

  constructor(
    private readonly users: UsersService,
    private readonly presence: PresenceService,
  ) {}

  start(io: AppServer) {
    this.io = io;
  }

  /** Fires when an agent's effective status may have changed (for routing). */
  onStatusChange(listener: AvailabilityListener) {
    this.listeners.push(listener);
  }

  /** Every approved agent with a profile (created on first use). */
  async listAgents(): Promise<AgentCandidate[]> {
    const agents = await this.users.listActiveAgents();
    const profiles = await this.ensureProfiles(agents.map((agent) => agent.id));
    return agents.map((user) => ({ user, profile: profiles.get(user.id)! }));
  }

  async listStatuses(): Promise<AgentStatusResponse[]> {
    const agents = await this.listAgents();
    const presence = await this.presence.snapshot(agents.map((agent) => agent.user.id));
    return agents.map(({ user, profile }) => toAgentStatus(user, profile, presence[user.id]));
  }

  async getStatus(agentId: string): Promise<AgentStatusResponse> {
    const user = await this.users.findPublicById(agentId);
    if (!user || user.role !== 'agent' || user.status !== 'approved') throw HttpError.notFound('AGENT_NOT_FOUND', 'Agent not found');
    const profile = (await this.ensureProfiles([agentId])).get(agentId)!;
    const presence = await this.presence.snapshot([agentId]);
    return toAgentStatus(user, profile, presence[agentId]);
  }

  async isAgent(userId: string): Promise<boolean> {
    const user = await this.users.findPublicById(userId);
    return user?.role === 'agent' && user.status === 'approved';
  }

  async setAvailability(agentId: string, availability: AgentAvailability): Promise<AgentStatusResponse> {
    await this.ensureProfiles([agentId]);
    await AgentProfile.updateOne({ userId: agentId }, { $set: { availability } });
    const status = await this.broadcastStatus(agentId);
    this.notify(agentId, status.status);
    return status;
  }

  async updateSettings(agentId: string, settings: UpdateAgentSettingsDto): Promise<AgentStatusResponse> {
    await this.getStatus(agentId); // 404 if not an agent
    await AgentProfile.updateOne({ userId: agentId }, { $set: settings });
    const status = await this.broadcastStatus(agentId);
    this.notify(agentId, status.status); // more capacity may mean queued chats can go to them
    return status;
  }

  /**
   * Atomically takes one chat slot if the agent is below capacity.
   * `force` (manual claim/transfer) ignores the limit but still counts the chat.
   */
  async reserveSlot(agentId: string, force = false): Promise<boolean> {
    const profile = (await this.ensureProfiles([agentId])).get(agentId)!;
    const filter = force
      ? { userId: agentId }
      : { userId: agentId, activeChats: { $lt: profile.maxConcurrentChats } };
    const result = await AgentProfile.updateOne(filter, { $inc: { activeChats: 1 }, $set: { lastAssignedAt: new Date() } });
    return result.modifiedCount === 1;
  }

  async releaseSlot(agentId: string): Promise<void> {
    await AgentProfile.updateOne({ userId: agentId, activeChats: { $gt: 0 } }, { $inc: { activeChats: -1 } });
  }

  /** Self-healing: overwrite the counters with the real number of open chats. */
  async syncActiveChats(counts: Record<string, number>): Promise<void> {
    const ops = Object.entries(counts).map(([agentId, count]) => ({
      updateOne: { filter: { userId: new Types.ObjectId(agentId), activeChats: { $ne: count } }, update: { $set: { activeChats: count } } },
    }));
    if (ops.length > 0) await AgentProfile.bulkWrite(ops);
  }

  /** Sends one agent's current status to every staff dashboard (on every server). */
  async broadcastStatus(agentId: string): Promise<AgentStatusResponse> {
    const status = await this.getStatus(agentId);
    this.io?.to(rooms.staff).emit('agent:status', status);
    return status;
  }

  private notify(agentId: string, status: AgentAvailability) {
    for (const listener of this.listeners) {
      try {
        listener(agentId, status);
      } catch (error) {
        logger.warn({ error }, 'Agent status listener failed');
      }
    }
  }

  /** Creates missing profiles in one bulk upsert and returns all of them by userId. */
  private async ensureProfiles(agentIds: string[]): Promise<Map<string, LeanAgentProfile>> {
    if (agentIds.length > 0) {
      await AgentProfile.bulkWrite(
        agentIds.map((id) => ({
          updateOne: {
            filter: { userId: new Types.ObjectId(id) },
            // bulkWrite upserts do NOT apply schema defaults, so every field is set explicitly.
            update: {
              $setOnInsert: {
                userId: new Types.ObjectId(id),
                availability: 'offline',
                skills: [],
                maxConcurrentChats: DEFAULT_MAX_CHATS,
                activeChats: 0,
                lastAssignedAt: null,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    const profiles = await AgentProfile.find({ userId: { $in: agentIds } }).lean<Partial<LeanAgentProfile>[]>();
    return new Map(profiles.map((profile) => [profile.userId!.toString(), normalizeProfile(profile)]));
  }
}
