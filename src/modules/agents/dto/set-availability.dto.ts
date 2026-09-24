import { z } from 'zod';
import { agentAvailabilities } from '../models/agent-profile.types.js';

export const setAvailabilityDto = z.object({ availability: z.enum(agentAvailabilities) });
export type SetAvailabilityDto = z.infer<typeof setAvailabilityDto>;
