import { model } from 'mongoose';
import { messageSchema } from '../schemas/message.schema.js';
import type { MessageDocument } from './message.types.js';

export const Message = model<MessageDocument>('Message', messageSchema);
