import type { PresenceSnapshot } from '../presence/presence.store.js';
import type { PublicUser } from '../users/users.mapper.js';
import type { AgentAvailability, LeanAgentProfile } from './models/agent-profile.types.js';

export interface AgentStatusResponse {
  agentId: string;
  name: string;
  email: string;
  /** What the agent chose. */
  availability: AgentAvailability;
  /** Has at least one live socket right now. */
  connected: boolean;
  /** What dashboards should show: offline if not connected, else the chosen availability. */
  status: AgentAvailability;
  activeChats: number;
  maxConcurrentChats: number;
  skills: string[];
  lastSeen: string | null;
}

export const toAgentStatus = (user: PublicUser, profile: LeanAgentProfile, presence: PresenceSnapshot | undefined): AgentStatusResponse => {
  const connected = presence?.online ?? false;
  return {
    agentId: user.id,
    name: user.name,
    email: user.email,
    availability: profile.availability,
    connected,
    status: connected ? profile.availability : 'offline',
    activeChats: profile.activeChats,
    maxConcurrentChats: profile.maxConcurrentChats,
    skills: profile.skills,
    lastSeen: presence?.lastSeen ?? null,
  };
};
