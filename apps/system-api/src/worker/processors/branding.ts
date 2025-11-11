import { Worker } from 'bullmq';
import type { Prisma } from '@prisma/client';

import type { BrandingScanJob } from '../../queues/producers';
import type { WorkerContext } from '../context';
import { serializeForAudit } from '../utils/audit';
import { captureWorkerException, withSentryJobScope } from '../../observability/sentry-worker';

export function createBrandingScanWorker(context: WorkerContext): Worker<BrandingScanJob> {
  const worker = new Worker<BrandingScanJob>(
    'branding-scan',
    async (job) => {
      await withSentryJobScope(job, async () => {
        if (job.name !== 'branding-scan') {
          context.logger.warn({ jobName: job.name }, 'Unsupported branding scan job');
          return;
        }

        await runBrandingProfileHealthCheck(context, job.data);
      });
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Branding scan job failed');
    if (job) {
      captureWorkerException(error, job);
    } else {
      captureWorkerException(error);
    }
  });

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Branding scan worker error');
    captureWorkerException(error);
  });

  return worker;
}

async function runBrandingProfileHealthCheck(
  context: WorkerContext,
  job: BrandingScanJob,
): Promise<void> {
  const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const whereClause: Prisma.BrandingProfileWhereInput = {
    status: 'suspended',
    updatedAt: { lt: threshold },
  };

  if (job.customerProfileId) {
    whereClause.ownerType = 'customer';
    whereClause.ownerId = job.customerProfileId;
  }

  const staleProfiles = await context.prisma.brandingProfile.findMany({
    where: whereClause,
  });

  if (staleProfiles.length === 0) {
    context.logger.debug({ threshold, filter: whereClause }, 'Branding profile scan found no stale profiles');
    return;
  }

  for (const profile of staleProfiles) {
    await context.prisma.$transaction(async (tx) => {
      const updated = await tx.brandingProfile.update({
        where: { id: profile.id },
        data: { status: 'revoked' },
      });

      await tx.auditLog.create({
        data: {
          tableName: 'branding_profiles',
          recordId: updated.id,
          operation: 'UPDATE',
          userId: null,
          oldData: serializeForAudit(profile),
          newData: serializeForAudit(updated),
        },
      });
    });
  }

  context.logger.info(
    { revokedProfiles: staleProfiles.length, threshold, filter: whereClause },
    'Revoked stale suspended branding profiles',
  );
}
