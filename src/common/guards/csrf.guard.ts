import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../errors/http-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const tokensMatch = (received: string, expected: string) => {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
};

export const createCsrfToken = (request: Request): string => {
  const token = randomBytes(32).toString('hex');
  request.session.csrfToken = token;
  return token;
};

/** GET /auth/csrf-token */
export const issueCsrfToken = (request: Request, response: Response) => {
  response.json({ csrfToken: request.session.csrfToken ?? createCsrfToken(request) });
};

/**
 * Checks the `x-csrf-token` header on every unsafe method (POST/PUT/PATCH/DELETE).
 * Can be mounted once on the whole /api router instead of on each route.
 */
export const requireCsrfToken = (request: Request, _response: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(request.method)) return next();
  const token = request.get('x-csrf-token');
  if (!token || !request.session.csrfToken || !tokensMatch(token, request.session.csrfToken)) {
    return next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'Invalid CSRF token'));
  }
  next();
};