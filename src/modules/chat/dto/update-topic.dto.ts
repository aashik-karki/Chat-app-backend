import { z } from 'zod';
import { conversationTopics } from '../models/conversation.types.js';

export const updateTopicDto = z.object({ topic: z.enum(conversationTopics) });
export type UpdateTopicDto = z.infer<typeof updateTopicDto>;
