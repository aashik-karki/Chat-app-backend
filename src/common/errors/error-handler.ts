import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { logger } from '../../core/logger.js';
import { HttpError } from './http-error.js';

/** 404 for any /api route nobody handled. Register after all routers. */
export const notFoundHandler = (request: Request, _response: Response, next: NextFunction) => {
  next(HttpError.notFound('ROUTE_NOT_FOUND', `Route ${request.method} ${request.originalUrl.split("?")[0]} not found`));
};

/** Single place that turns any thrown error into the API's JSON error shape. */
export const errorHandler = (error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) return next(error);

  if (error instanceof ZodError) {
    logger.warn({ path: request.path, issues: error.issues }, 'Validation failed');
    return response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: z.flattenError(error).fieldErrors },
    });
  }

  if (error instanceof HttpError) {
    const log = error.statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log({ path: request.path, code: error.code }, error.message);
    return response.status(error.statusCode).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }

  logger.error({ error, path: request.path }, 'Unhandled error');
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
