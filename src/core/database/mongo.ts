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

/**
 * Waits until every model's indexes exist. Mongoose builds them in the background
 * after connecting, so on a fresh database the first requests could run BEFORE a
 * unique index exists (e.g. two concurrent upserts creating duplicate rows).
 * Call once after all modules (and so all models) are loaded, before listening.
 */
export const ensureIndexes = async (): Promise<void> => {
  if (!isDatabaseReady()) return;
  const models = Object.values(mongoose.models);
  const results = await Promise.allSettled(models.map((model) => model.init()));
  // One index failing to build (e.g. duplicate data blocking a unique index) is logged
  // loudly but doesn't take the whole app down.
  results.forEach((result, index) => {
    if (result.status === 'rejected') logger.error({ error: result.reason, model: models[index]!.modelName }, 'Index build failed');
  });
  logger.info({ models: models.length, failed: results.filter((r) => r.status === 'rejected').length }, 'MongoDB indexes ready');
};
