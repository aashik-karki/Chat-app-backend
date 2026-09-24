import { z } from 'zod';

export const loginDto = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(128),
});
export type LoginDto = z.infer<typeof loginDto>;
