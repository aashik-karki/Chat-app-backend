import { Schema } from 'mongoose';
import { messageStatuses, type MessageDocument } from '../models/message.types.js';

export const messageSchema = new Schema<MessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientMessageId: { type: String, required: true, trim: true, maxlength: 100 },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    status: { type: String, enum: messageStatuses, required: true, default: 'sent' },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// History pagination: newest first, _id breaks ties between equal timestamps.
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Idempotent sends: a retried message with the same client id is not stored twice.
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });
// Unread counts and delivered/read updates: "messages in X not sent by me with status Y".
messageSchema.index({ conversationId: 1, status: 1, senderId: 1 });
