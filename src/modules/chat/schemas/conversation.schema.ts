import { Schema } from 'mongoose';
import { conversationStatuses, type ConversationDocument } from '../models/conversation.types.js';

export const conversationSchema = new Schema<ConversationDocument>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAgentId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: conversationStatuses, required: true, default: 'open' },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true },
);

// One support thread per customer (also makes getOrCreate race-safe).
conversationSchema.index({ customerId: 1 }, { unique: true });
// Staff inbox: most recently active first.
conversationSchema.index({ lastMessageAt: -1 });
// Agent inbox / assignment queue: "my open chats" and "unassigned open chats".
conversationSchema.index({ assignedAgentId: 1, status: 1, lastMessageAt: -1 });
