import { UsersController } from './users.controller.js';
import { createUsersRouter } from './users.routes.js';
import { UsersService } from './users.service.js';

/** Like a NestJS @Module: builds the service + controller and exposes the router. */
export const createUsersModule = () => {
  const usersService = new UsersService();
  const usersController = new UsersController(usersService);
  return {
    usersService,
    router: createUsersRouter(usersController),
  };
};
