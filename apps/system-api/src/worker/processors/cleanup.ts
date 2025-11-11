import { Worker } from 'bullmq';

import type { CleanupJob } from '../../queues/producers';
import type { WorkerContext } from '../context';

export function createCleanupWorker(context: WorkerContext): Worker<CleanupJob> {
  const worker = new Worker<CleanupJob>(
    'system-maintenance',
    async (job) => {
      if (job.name === 'expire-organization-invitations') {
        await expireOrganizationInvitations(context);
        return;
      }

      if (job.name === 'prune-stripe-webhook-events') {
        await pruneStripeWebhookEvents(context, job.data.olderThanDays);
        return;
      }

      context.logger.warn({ jobName: job.name }, 'Unsupported cleanup job received');
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Cleanup job failed');
  });

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Cleanup worker error');
  });

  return worker;
}

async function expireOrganizationInvitations(context: WorkerContext): Promise<void> {
  const now = new Date();
  const result = await context.prisma.organizationUser.updateMany({
    where: {
      status: 'invited',
      invitationExpiresAt: { lt: now },
      invitationToken: { not: null },
    },
    data: {
      status: 'revoked',
      invitationToken: null,
      invitationExpiresAt: null,
    },
  });

  if (result.count > 0) {
    context.logger.info({ expiredInvitations: result.count }, 'Expired organization invitations');
  }
}

async function pruneStripeWebhookEvents(
  context: WorkerContext,
  olderThanDays: number | undefined,
): Promise<void> {
  const days = olderThanDays ?? 30;
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await context.prisma.stripeWebhookEvent.deleteMany({
    where: {
      processed: true,
      processedAt: { lt: threshold },
    },
  });

  if (result.count > 0) {
    context.logger.info({ deletedEvents: result.count, threshold }, 'Pruned processed Stripe webhook events');
  }
}
