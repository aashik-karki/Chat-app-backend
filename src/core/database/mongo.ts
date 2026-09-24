import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export const connectDatabase = async (): Promise<boolean> => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 5_000,
    });
    logger.info({ database: env.MONGODB_DB_NAME }, 'MongoDB connected');
    return true;
  } catch (error) {
    if (!env.ALLOW_INFRA_FAILURE) throw error;
    logger.warn({ error }, 'MongoDB unavailable; continuing without database access');
    return false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
};

export const isDatabaseReady = (): boolean => mongoose.connection.readyState === mongoose.ConnectionStates.connected;