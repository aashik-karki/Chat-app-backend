import { z } from 'zod';
import { objectIdSchema } from '../../../common/utils/object-id.js';

export const agentIdParamsDto = z.object({ agentId: objectIdSchema });
export type AgentIdParamsDto = z.infer<typeof agentIdParamsDto>;
