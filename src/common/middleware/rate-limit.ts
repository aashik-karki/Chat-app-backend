import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../core/logger.js';
import { isRedisReady, redis } from '../../core/redis/redis.js';
import { HttpError } from '../errors/http-error.js';

interface RateLimitOptions {
  /** Key prefix, e.g. 'login'. */
  name: string;
  /** Max requests per window. */
  max: number;
  windowSeconds: number;
  /** What to count by. Defaults to client IP. */
  keyBy?: (request: Request) => string;
}

/**
 * Fixed-window rate limiter stored in Redis, so the limit is shared across
 * all server instances. If Redis is down it lets the request through
 * (fail-open) instead of locking everyone out.
 */
export const rateLimit = ({ name, max, windowSeconds, keyBy }: RateLimitOptions) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!isRedisReady()) return next();

    const identity = keyBy ? keyBy(request) : (request.ip ?? 'unknown');
    const key = `chat:ratelimit:${name}:${identity}`;

    try {
      const [[, count], [, ttl]] = (await redis.multi().incr(key).ttl(key).exec()) as [[null, number], [null, number]];
      if (ttl < 0) await redis.expire(key, windowSeconds);

      response.setHeader('RateLimit-Limit', max);
      response.setHeader('RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        response.setHeader('Retry-After', ttl > 0 ? ttl : windowSeconds);
        throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later');
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      logger.warn({ error, name }, 'Rate limiter failed; allowing request');
    }
    next();
  };
