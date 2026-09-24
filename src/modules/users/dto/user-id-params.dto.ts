import { z } from 'zod';
import { objectIdSchema } from '../../../common/utils/object-id.js';

export const userIdParamsDto = z.object({ userId: objectIdSchema });
export type UserIdParamsDto = z.infer<typeof userIdParamsDto>;
