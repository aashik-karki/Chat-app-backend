import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { logger } from '../../../core/logger.js';
import { createRedisConnection } from '../../../core/redis/redis.js';
import { rooms } from '../../../realtime/rooms.js';
import type { AppServer } from '../../../realtime/socket.types.js';
import type { ConversationsService } from '../../chat/services/conversations.service.js';
import type { MetricsService } from '../../metrics/metrics.service.js';
import type { PushSubscriptionsService } from './push-subscriptions.service.js';
import { sendWebPush, type PushPayload } from './web-push.sender.js';

const QUEUE_NAME = 'push-notifications';
const PREVIEW_LENGTH = 120;
/** Give auto-assignment a moment, so a customer's first message can notify the agent it was routed to. */
const CUSTOMER_MESSAGE_DELAY_MS = 1_500;

interface MessageJob {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  senderIsCustomer: boolean;
  text: string;
}

interface DeliverJob {
  subscriptionId: string;
  payload: PushPayload;
}

/**
 * Reliable push delivery with BullMQ (Redis-backed, shared by every server):
 *
 *   message job  → works out WHO to notify (the other side of the chat, if
 *                  they aren't looking at it right now), then fans out…
 *   deliver jobs → one per device, each retried on its own with exponential
 *                  backoff (5s, 10s, 20s, 40s, 80s). One flaky device never
 *                  causes duplicate notifications on the others.
 *
 * Expired subscriptions (HTTP 404/410 from the push service) are deleted.
 * Job ids are derived from message ids, so the same message is never queued twice.
 */
export class PushQueueService {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private io: AppServer | null = null;

  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly conversations: ConversationsService,
    private readonly metrics: MetricsService,
  ) {}

  start(io: AppServer) {
    this.io = io;
    this.queue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection('bullmq-queue'),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000, age: 7 * 24 * 3600 },
      },
    });
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), {
      connection: createRedisConnection('bullmq-worker'),
      concurrency: 20,
    });
    this.worker.on('failed', (job, error) => {
      if (!job || job.name !== 'deliver') return;
      const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError;
      if (finalAttempt) {
        this.metrics.recordPush('failed');
        void this.subscriptions.markFailure((job.data as DeliverJob).subscriptionId).catch(() => undefined);
        logger.warn({ jobId: job.id, error: error.message }, 'Push delivery failed permanently');
      }
    });
    this.worker.on('error', (error) => logger.warn({ error }, 'Push worker error'));
    logger.info('Push notification queue started');
  }

  async stop() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Called for every new chat message. Cheap: just queues a job. */
  async enqueueForMessage(data: MessageJob): Promise<void> {
    if (!this.queue) return;
    await this.queue.add('message', { ...data, text: data.text.slice(0, PREVIEW_LENGTH) } satisfies MessageJob, {
      jobId: `message-${data.messageId}`,
      delay: data.senderIsCustomer ? CUSTOMER_MESSAGE_DELAY_MS : 0,
      attempts: 3,
    });
  }

  private async process(job: Job): Promise<void> {
    if (job.name === 'message') return this.fanOut(job.data as MessageJob);
    if (job.name === 'deliver') return this.deliver(job.data as DeliverJob);
    throw new UnrecoverableError(`Unknown push job ${job.name}`);
  }

  private async fanOut(data: MessageJob): Promise<void> {
    const conversation = await this.conversations.findById(data.conversationId);
    if (!conversation) return;

    const recipientId = data.senderIsCustomer
      ? (conversation.assignedAgentId?.toString() ?? null) // nobody assigned yet → dashboards show it; no push
      : conversation.customerId.toString();
    if (!recipientId || recipientId === data.senderId) return;

    // Already looking at this chat (in any tab, on any server)? Then the socket delivered it; no push.
    if (this.io) {
      const viewers = await this.io.in(rooms.conversation(data.conversationId)).fetchSockets();
      if (viewers.some((socket) => socket.data.user.id === recipientId)) return;
    }

    const devices = await this.subscriptions.listForUser(recipientId);
    if (devices.length === 0 || !this.queue) return;

    const payload: PushPayload = {
      type: 'message',
      title: data.senderName,
      body: data.text,
      conversationId: data.conversationId,
      messageId: data.messageId,
      url: `/chat/${data.conversationId}`,
      tag: `conversation-${data.conversationId}`,
    };
    await this.queue.addBulk(
      devices.map((device) => ({
        name: 'deliver',
        data: { subscriptionId: device.id, payload } satisfies DeliverJob,
        opts: { jobId: `deliver-${data.messageId}-${device.id}` },
      })),
    );
  }

  private async deliver({ subscriptionId, payload }: DeliverJob): Promise<void> {
    const device = await this.subscriptions.findById(subscriptionId);
    if (!device) return; // unsubscribed meanwhile

    if (device.expiresAt && device.expiresAt.getTime() <= Date.now()) {
      await this.subscriptions.deleteById(subscriptionId);
      this.metrics.recordPush('expired');
      return;
    }

    const result = await sendWebPush(device.subscription, payload);
    switch (result.outcome) {
      case 'sent':
        this.metrics.recordPush('sent');
        await this.subscriptions.markSuccess(subscriptionId);
        return;
      case 'gone':
        await this.subscriptions.deleteById(subscriptionId);
        this.metrics.recordPush('expired');
        return;
      case 'rejected':
        throw new UnrecoverableError(`Push rejected (${result.statusCode}): ${result.message}`);
      case 'retry':
        throw new Error(`Push temporarily failed (${result.statusCode ?? 'network'}): ${result.message}`);
    }
  }
}
