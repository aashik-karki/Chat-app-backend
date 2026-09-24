import { z } from 'zod';
import { conversationTopics } from '../../chat/models/conversation.types.js';

export const updateAgentSettingsDto = z
  .object({
    skills: z.array(z.enum(conversationTopics)).max(conversationTopics.length).optional(),
    maxConcurrentChats: z.number().int().min(1).max(50).optional(),
  })
  .refine((value) => value.skills !== undefined || value.maxConcurrentChats !== undefined, 'Nothing to update');
export type UpdateAgentSettingsDto = z.infer<typeof updateAgentSettingsDto>;
