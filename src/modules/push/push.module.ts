import { logger } from '../../core/logger.js';
import { isRedisReady } from '../../core/redis/redis.js';
import type { AppServer } from '../../realtime/socket.types.js';
import type { ChatGateway } from '../chat/chat.gateway.js';
import type { ConversationsService } from '../chat/services/conversations.service.js';
import type { MetricsService } from '../metrics/metrics.service.js';
import { PushController } from './push.controller.js';
import { createPushRouter } from './push.routes.js';
import { PushQueueService } from './services/push-queue.service.js';
import { PushSubscriptionsService } from './services/push-subscriptions.service.js';
import { isPushConfigured } from './services/web-push.sender.js';

interface PushModuleDeps {
  conversationsService: ConversationsService;
  metricsService: MetricsService;
}

export const createPushModule = ({ conversationsService, metricsService }: PushModuleDeps) => {
  const subscriptionsService = new PushSubscriptionsService();
  const queueService = new PushQueueService(subscriptionsService, conversationsService, metricsService);
  const enabled = isPushConfigured() && isRedisReady();

  return {
    router: createPushRouter(new PushController(subscriptionsService)),
    start: (io: AppServer, chatGateway: ChatGateway) => {
      if (!enabled) {
        logger.warn(
          { vapidConfigured: isPushConfigured(), redis: isRedisReady() },
          'Push notifications disabled (need VAPID keys and Redis)',
        );
        return;
      }
      queueService.start(io);
      chatGateway.onMessageCreated(({ conversation, message, sender }) => {
        void queueService
          .enqueueForMessage({
            conversationId: conversation.id,
            messageId: message.id,
            senderId: sender.id,
            senderName: sender.name,
            senderIsCustomer: sender.id === conversation.customerId,
            text: message.text,
          })
          .catch((error) => logger.warn({ error }, 'Could not queue push notification'));
      });
    },
    stop: () => queueService.stop(),
  };
};
