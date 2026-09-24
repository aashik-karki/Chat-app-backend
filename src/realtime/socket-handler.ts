import type { z } from 'zod';
import { HttpError } from '../common/errors/http-error.js';
import { logger } from '../core/logger.js';
import type { Ack, AckResponse, AppSocket } from './socket.types.js';

interface HandlerOptions {
  /** Max events per window for THIS socket (in-memory; a socket lives on one server). */
  rateLimit?: { max: number; windowMs: number };
}

const toErrorResponse = (error: unknown, event: string, socket: AppSocket): AckResponse => {
  if (error instanceof HttpError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  logger.error({ error, event, socketId: socket.id, userId: socket.data.user?.id }, 'Socket handler failed');
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
};

/**
 * Registers a socket event with the same guarantees the REST layer has:
 *  - payload validated by a zod DTO (bad input → INVALID_PAYLOAD, never a crash)
 *  - optional per-socket rate limit (→ RATE_LIMITED)
 *  - every thrown error is caught, logged, and turned into an ack error
 *  - the ack is optional: clients that don't pass a callback still work
 */
export const onEvent = <S extends z.ZodType>(
  socket: AppSocket,
  event: string,
  schema: S,
  handler: (input: z.infer<S>) => unknown | Promise<unknown>,
  options: HandlerOptions = {},
) => {
  const hits: number[] = [];

  socket.on(event, async (payload: unknown, maybeAck?: unknown) => {
    const ack: Ack = typeof maybeAck === 'function' ? (maybeAck as Ack) : () => undefined;

    if (options.rateLimit) {
      const now = Date.now();
      while (hits.length > 0 && hits[0]! <= now - options.rateLimit.windowMs) hits.shift();
      if (hits.length >= options.rateLimit.max) {
        ack({ ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } });
        return;
      }
      hits.push(now);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      ack({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid payload', details: parsed.error.issues.map((i) => i.message) },
      });
      return;
    }

    try {
      const data = await handler(parsed.data);
      ack(data === undefined ? { ok: true } : { ok: true, data });
    } catch (error) {
      ack(toErrorResponse(error, event, socket));
    }
  });
};
