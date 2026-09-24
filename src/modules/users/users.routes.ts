import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { requireCsrfToken } from '../../common/guards/csrf.guard.js';
import { requirePermission } from '../../common/guards/permission.guard.js';
import { validate } from '../../common/middleware/validate.pipe.js';
import { listUsersQueryDto } from './dto/list-users-query.dto.js';
import { updateApprovalDto } from './dto/update-approval.dto.js';
import { updateRoleDto } from './dto/update-role.dto.js';
import { userIdParamsDto } from './dto/user-id-params.dto.js';
import type { UsersController } from './users.controller.js';

/** Mounted at /api/v1/admin/users */
export const createUsersRouter = (controller: UsersController) => {
  const router = Router();

  router.use(requireAuth, requirePermission('user:approve'));

  router.get('/', validate({ query: listUsersQueryDto }), controller.list);
  router.get('/summary', controller.summary);
  router.patch(
    '/:userId/approval',
    requireCsrfToken,
    validate({ params: userIdParamsDto, body: updateApprovalDto }),
    controller.updateApproval,
  );
  router.patch(
    '/:userId/role',
    requireCsrfToken,
    requirePermission('agent:manage'),
    validate({ params: userIdParamsDto, body: updateRoleDto }),
    controller.updateRole,
  );

  return router;
};
