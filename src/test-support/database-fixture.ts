import mongoose from 'mongoose';

const TEST_MONGODB_URI = process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';

export interface TestDatabase {
  connected: boolean;
  disconnect: () => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Connects to a real MongoDB for integration tests, isolated in a dedicated
 * `chat_backend_test` database so this never touches development data.
 *
 * Returns `connected: false` instead of throwing when no MongoDB is
 * reachable (e.g. a machine or CI runner without one set up), so these
 * suites skip cleanly rather than failing the whole test run. Run a local
 * MongoDB (the same one the app's README asks for) to exercise them.
 */
export const connectTestDatabase = async (): Promise<TestDatabase> => {
  try {
    await mongoose.connect(TEST_MONGODB_URI, {
      dbName: 'chat_backend_test',
      serverSelectionTimeoutMS: 1_500,
    });
    return {
      connected: true,
      disconnect: async () => {
        await mongoose.disconnect();
      },
      reset: async () => {
        const { collections } = mongoose.connection;
        await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
      },
    };
  } catch {
    return { connected: false, disconnect: async () => undefined, reset: async () => undefined };
  }
};
