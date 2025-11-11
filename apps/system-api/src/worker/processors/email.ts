import { Worker } from 'bullmq';

import type { InvitationJob } from '../../queues/producers';
import type { WorkerContext } from '../context';
import { captureWorkerException, withSentryJobScope } from '../../observability/sentry-worker';

export function createEmailWorker(context: WorkerContext): Worker<InvitationJob> {
  const worker = new Worker<InvitationJob>(
    'customer-organization-invitations',
    async (job) => {
      await withSentryJobScope(job, async () => {
        await context.emailService.sendOrganizationInvitation(job.data);
      });
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 5,
    },
  );

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Email worker error');
    captureWorkerException(error);
  });

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Email job failed');
    if (job) {
      captureWorkerException(error, job);
    } else {
      captureWorkerException(error);
    }
  });

  return worker;
}
