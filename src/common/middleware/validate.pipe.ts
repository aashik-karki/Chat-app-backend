import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export interface ValidatedInput {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/**
 * Like a NestJS ValidationPipe. Parses body/query/params with zod DTOs and
 * stores the clean values on `res.locals.dto` (Express 5 makes `req.query`
 * read-only, so we don't overwrite the request). ZodErrors go to the error
 * handler, which returns 400.
 */
export const validate = (schemas: ValidationSchemas) => (request: Request, response: Response, next: NextFunction) => {
  const dto: ValidatedInput = {};
  if (schemas.params) dto.params = schemas.params.parse(request.params);
  if (schemas.query) dto.query = schemas.query.parse(request.query);
  if (schemas.body) dto.body = schemas.body.parse(request.body);
  response.locals.dto = dto;
  next();
};

/** Typed helpers so controllers read validated input instead of raw req.* */
export const getBody = <T>(response: Response): T => (response.locals.dto as ValidatedInput).body as T;
export const getQuery = <T>(response: Response): T => (response.locals.dto as ValidatedInput).query as T;
export const getParams = <T>(response: Response): T => (response.locals.dto as ValidatedInput).params as T;