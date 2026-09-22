import { Schema, Types, model } from 'mongoose';

export interface ConversationDocument {
  // The regular user this support thread belongs to. Admins are not listed
  // as participants; any admin may access any conversation (see
  // conversation-service) until agent assignment/routing is implemented.
  customerId: Types.ObjectId;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDocument>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 4000 },
  },
  { timestamps: true },
);

// Each customer has exactly one support conversation.
conversationSchema.index({ customerId: 1 }, { unique: true });
// Admin dashboard: every conversation, most recently active first.
conversationSchema.index({ lastMessageAt: -1 });

export const Conversation = model<ConversationDocument>('Conversation', conversationSchema);
