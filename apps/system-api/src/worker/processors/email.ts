import { Worker } from 'bullmq';

import type { InvitationJob } from '../../queues/producers';
import type { WorkerContext } from '../context';

export function createEmailWorker(context: WorkerContext): Worker<InvitationJob> {
  const worker = new Worker<InvitationJob>(
    'customer-organization-invitations',
    async (job) => {
      await context.emailService.sendOrganizationInvitation(job.data);
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 5,
    },
  );

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Email worker error');
  });

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Email job failed');
  });

  return worker;
}
