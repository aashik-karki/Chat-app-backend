import { Schema } from 'mongoose';
import { roles } from '../../../common/auth/permissions.js';
import { accountStatuses, type UserDocument } from '../models/user.types.js';

export const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    // `unique: true` here already creates the index — no separate schema.index() needed.
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 320 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: roles, required: true, default: 'user' },
    status: { type: String, enum: accountStatuses, required: true, default: 'pending' },
  },
  { timestamps: true },
);

// Admin list: users of a role filtered by status, newest first.
userSchema.index({ role: 1, status: 1, createdAt: -1 });