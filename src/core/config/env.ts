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
  // Web Push (optional: push is disabled until both keys are set; generate with `npm run push:vapid`)
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:)/, 'must start with mailto: or https:').default('mailto:admin@example.com'),
  // 32 random bytes, base64. Encrypts stored push subscriptions. If unset, derived from SESSION_SECRET.
  PUSH_ENCRYPTION_KEY: z.string().optional(),
  // Bearer token for the Prometheus endpoint GET /metrics. If unset, that endpoint is off.
  METRICS_TOKEN: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

// Treat `KEY=` (empty) in .env as unset, so optional settings can be left blank.
const cleaned = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
const result = envSchema.safeParse(cleaned);

if (!result.success) {
  console.error('Invalid environment configuration', z.flattenError(result.error).fieldErrors);
  process.exit(1);
}

export const env = result.data;
export const isProduction = env.NODE_ENV === 'production';
