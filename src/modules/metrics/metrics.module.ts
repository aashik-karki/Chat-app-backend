import { isRedisReady, redis } from '../../core/redis/redis.js';
import type { AgentsService } from '../agents/services/agents.service.js';
import type { ConversationsService } from '../chat/services/conversations.service.js';
import type { PresenceService } from '../presence/presence.service.js';
import { AnalyticsService } from './analytics.service.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsGateway } from './metrics.gateway.js';
import { createMetricsRouter } from './metrics.routes.js';
import { MetricsService } from './metrics.service.js';

interface MetricsModuleDeps {
  presenceService: PresenceService;
  agentsService: AgentsService;
  conversationsService: ConversationsService;
}

export const createMetricsModule = ({ presenceService, agentsService, conversationsService }: MetricsModuleDeps) => {
  const metricsService = new MetricsService(isRedisReady() ? redis : null, presenceService, agentsService, conversationsService);
  const controller = new MetricsController(metricsService, new AnalyticsService(isRedisReady() ? redis : null));
  return {
    metricsService,
    router: createMetricsRouter(controller),
    /** GET /metrics (Prometheus) lives outside /api/v1, like most scrapers expect. */
    prometheusHandler: controller.prometheus,
    gateway: new MetricsGateway(metricsService),
  };
};
