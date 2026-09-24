import { model } from 'mongoose';
import { conversationSchema } from '../schemas/conversation.schema.js';
import type { ConversationDocument } from './conversation.types.js';

export const Conversation = model<ConversationDocument>('Conversation', conversationSchema);
