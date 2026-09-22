import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4001),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  CORS_ALLOW_ALL: z.coerce.boolean().default(false),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default('chat_backend'),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  ALLOW_INFRA_FAILURE: z.coerce.boolean().default(false),
  LOG_LEVEL: z.string().default('info'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration', result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
