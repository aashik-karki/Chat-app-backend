import { Schema } from 'mongoose';
import { conversationTopics } from '../../chat/models/conversation.types.js';
import { agentAvailabilities, type AgentProfileDocument } from '../models/agent-profile.types.js';

export const agentProfileSchema = new Schema<AgentProfileDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    availability: { type: String, enum: agentAvailabilities, required: true, default: 'offline' },
    skills: { type: [{ type: String, enum: conversationTopics }], default: [] },
    maxConcurrentChats: { type: Number, required: true, default: 5, min: 1, max: 50 },
    activeChats: { type: Number, required: true, default: 0, min: 0 },
    lastAssignedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

agentProfileSchema.index({ userId: 1 }, { unique: true });
// Routing query: available agents, least loaded first, longest-waiting first.
agentProfileSchema.index({ availability: 1, activeChats: 1, lastAssignedAt: 1 });
