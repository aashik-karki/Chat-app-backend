import { AuthController } from './auth.controller.js';
import { createAuthRouter } from './auth.routes.js';
import { AuthService } from './auth.service.js';

export const createAuthModule = () => {
  const authService = new AuthService();
  const authController = new AuthController(authService);
  return {
    authService,
    router: createAuthRouter(authController),
  };
};
