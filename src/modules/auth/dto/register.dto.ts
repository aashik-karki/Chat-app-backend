import { z } from 'zod';
import { loginDto } from './login.dto.js';

export const registerDto = loginDto.extend({
  name: z.string().trim().min(1).max(100),
});
export type RegisterDto = z.infer<typeof registerDto>;
