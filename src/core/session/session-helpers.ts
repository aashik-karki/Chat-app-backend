import type { Request } from 'express';

/** Promise versions of express-session's callback methods. */
export const regenerateSession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));

export const saveSession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())));

export const destroySession = (request: Request) =>
  new Promise<void>((resolve, reject) => request.session.destroy((error) => (error ? reject(error) : resolve())));
