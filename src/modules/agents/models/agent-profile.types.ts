import type { Types } from 'mongoose';
import type { ConversationTopic } from '../../chat/models/conversation.types.js';

/** What the agent CHOSE. Their real status also depends on being connected (see agents.mapper). */
export const agentAvailabilities = ['online', 'busy', 'offline'] as const;
export type AgentAvailability = (typeof agentAvailabilities)[number];

export interface AgentProfileDocument {
  userId: Types.ObjectId;
  availability: AgentAvailability;
  /** Topics this agent handles best (skill-based routing). Empty = generalist. */
  skills: ConversationTopic[];
  maxConcurrentChats: number;
  /** Open chats assigned right now. Changed atomically on assign/release; re-counted every 30s. */
  activeChats: number;
  /** Tie-breaker: among equally loaded agents, the one who waited longest gets the next chat. */
  lastAssignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LeanAgentProfile = AgentProfileDocument & { _id: Types.ObjectId };
