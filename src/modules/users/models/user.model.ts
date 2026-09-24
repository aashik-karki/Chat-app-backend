import { model } from 'mongoose';
import { userSchema } from '../schemas/user.schema.js';
import type { UserDocument } from './user.types.js';

export const User = model<UserDocument>('User', userSchema);