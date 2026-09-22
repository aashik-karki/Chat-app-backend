import { Schema, model } from 'mongoose';

export const userRoles = ['admin', 'user'] as const;
export const accountStatuses = ['pending', 'approved', 'rejected'] as const;

export type UserRole = (typeof userRoles)[number];
export type AccountStatus = (typeof accountStatuses)[number];

export interface UserDocument {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 320 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: userRoles, required: true, default: 'user', immutable: true },
    status: { type: String, enum: accountStatuses, required: true, default: 'pending' },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ status: 1, createdAt: -1 });

export const User = model<UserDocument>('User', userSchema);
