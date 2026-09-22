import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http-error.js';

const tokensMatch = (received: string, expected: string) => {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
};

export const issueCsrfToken = (request: Request, response: Response) => {
  const token = randomBytes(32).toString('hex');
  request.session.csrfToken = token;
  response.json({ csrfToken: token });
};

export const requireCsrfToken = (request: Request, _response: Response, next: NextFunction) => {
  const token = request.get('x-csrf-token');
  if (!token || !request.session.csrfToken || !tokensMatch(token, request.session.csrfToken)) {
    return next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'Invalid CSRF token'));
  }
  next();
};
