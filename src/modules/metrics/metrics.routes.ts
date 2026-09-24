import { Router } from 'express';
import { requireAuth } from '../../common/guards/auth.guard.js';
import { requirePermission } from '../../common/guards/permission.guard.js';
import type { MetricsController } from './metrics.controller.js';

/** Mounted at /api/v1/metrics */
export const createMetricsRouter = (controller: MetricsController) => {
  const router = Router();
  router.get('/overview', requireAuth, requirePermission('metrics:view'), controller.overview);
  return router;
};
