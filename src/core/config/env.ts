import 'dotenv/config';
import { z } from 'zod';

// z.coerce.boolean() turns ANY non-empty string (even "false") into true,
// so booleans from .env must be parsed explicitly.
const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:3000'),
  CORS_ALLOW_ALL: booleanFromEnv,
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default('chat_backend'),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  ALLOW_INFRA_FAILURE: booleanFromEnv,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration', z.flattenError(result.error).fieldErrors);
  process.exit(1);
}

export const env = result.data;
export const isProduction = env.NODE_ENV === 'production';