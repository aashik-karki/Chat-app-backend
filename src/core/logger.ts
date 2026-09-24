import pino from 'pino';
import { env } from './config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  // pino only serializes Error objects under `err` by default; this codebase
  // logs them as `{ error }`, which would otherwise print as `{}` (no message, no stack).
  serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
});
