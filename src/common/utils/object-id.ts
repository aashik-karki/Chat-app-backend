import { z } from 'zod';

/** Reusable zod rule for a Mongo ObjectId in params/body. */
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');