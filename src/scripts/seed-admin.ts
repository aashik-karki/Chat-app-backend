import bcrypt from 'bcryptjs';
import { env } from '../core/config/env.js';
import { connectDatabase, disconnectDatabase, isDatabaseReady } from '../core/database/mongo.js';
import { logger } from '../core/logger.js';
import { User } from '../modules/users/models/user.model.js';

const seedAdmin = async () => {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set before seeding an admin');
  }
  if (!(await connectDatabase()) || !isDatabaseReady()) {
    throw new Error('MongoDB connection is required to seed an admin');
  }

  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email }).select('role');
  if (existing) {
    if (existing.role !== 'admin') throw new Error('A non-admin user already uses ADMIN_EMAIL');
    logger.info({ email }, 'Admin already exists; no changes made');
    return;
  }

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await User.create({ name: 'Administrator', email, passwordHash, role: 'admin', status: 'approved' });
  logger.info({ email }, 'Admin user created');
};

void seedAdmin()
  .catch((error) => {
    logger.fatal({ error }, 'Admin seed failed');
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase());
