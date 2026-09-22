import { Schema, Types, model } from 'mongoose';

export interface ConversationDocument {
  participants: Types.ObjectId[];
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDocument>(
  {
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (value: Types.ObjectId[]) => value.length >= 2,
        message: 'A conversation requires at least two participants',
      },
    },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Look up "does this conversation already exist between these two people"
// and "list my conversations, most recently active first".
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export const Conversation = model<ConversationDocument>('Conversation', conversationSchema);
