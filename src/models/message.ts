import { Schema, Types, model } from 'mongoose';

export const messageStatuses = ['sent', 'delivered', 'read'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export interface MessageDocument {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  clientMessageId: string;
  text: string;
  status: MessageStatus;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Set by the sending client so retried sends (e.g. after a dropped ack)
    // never create duplicate messages. See the unique index below.
    clientMessageId: { type: String, required: true, trim: true, maxlength: 100 },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    status: { type: String, enum: messageStatuses, required: true, default: 'sent' },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Cursor pagination: newest messages in a conversation first.
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Idempotency: a retried send with the same client id is a no-op, not a duplicate.
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });

export const Message = model<MessageDocument>('Message', messageSchema);
