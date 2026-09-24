import type { Request, Response } from 'express';
import { getCurrentUser } from '../../common/auth/current-user.js';
import { getBody, getParams, getQuery } from '../../common/middleware/validate.pipe.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UpdateApprovalDto } from './dto/update-approval.dto.js';
import type { UpdateRoleDto } from './dto/update-role.dto.js';
import type { UserIdParamsDto } from './dto/user-id-params.dto.js';
import type { UsersService } from './users.service.js';

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  list = async (_request: Request, response: Response) => {
    const users = await this.usersService.list(getQuery<ListUsersQueryDto>(response));
    response.json({ users });
  };

  summary = async (_request: Request, response: Response) => {
    response.json(await this.usersService.summary());
  };

  updateApproval = async (_request: Request, response: Response) => {
    const { userId } = getParams<UserIdParamsDto>(response);
    const user = await this.usersService.updateApproval(userId, getBody<UpdateApprovalDto>(response));
    response.json({ user });
  };

  updateRole = async (_request: Request, response: Response) => {
    const { userId } = getParams<UserIdParamsDto>(response);
    const admin = getCurrentUser(response);
    const user = await this.usersService.updateRole(userId, getBody<UpdateRoleDto>(response), admin.id);
    response.json({ user });
  };
}
