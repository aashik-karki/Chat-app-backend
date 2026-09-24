import { model } from 'mongoose';
import { agentProfileSchema } from '../schemas/agent-profile.schema.js';
import type { AgentProfileDocument } from './agent-profile.types.js';

export const AgentProfile = model<AgentProfileDocument>('AgentProfile', agentProfileSchema);
