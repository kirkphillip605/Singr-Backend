import { Worker } from 'bullmq';

import type { SongIndexRefreshJob } from '../../queues/producers';
import type { WorkerContext } from '../context';
import { captureWorkerException, withSentryJobScope } from '../../observability/sentry-worker';

export function createSongIndexWorker(context: WorkerContext): Worker<SongIndexRefreshJob> {
  const worker = new Worker<SongIndexRefreshJob>(
    'songdb-index-refresh',
    async (job) => {
      await withSentryJobScope(job, async () => {
        await refreshSongIndex(context, job.data);
      });
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Song index job failed');
    if (job) {
      captureWorkerException(error, job);
    } else {
      captureWorkerException(error);
    }
  });

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Song index worker error');
    captureWorkerException(error);
  });

  return worker;
}

async function refreshSongIndex(context: WorkerContext, job: SongIndexRefreshJob): Promise<void> {
  const cacheKey = buildSongdbCacheKey(job.customerProfileId, job.openkjSystemId);
  await context.redis.incr(`${cacheKey}:version`);
  await context.redis.set(cacheKey, Date.now().toString(), 'EX', 300);
  await context.redis.incr('cache:public:songs:search:version');

  context.logger.info(
    {
      customerProfileId: job.customerProfileId,
      openkjSystemId: job.openkjSystemId,
    },
    'Song index refresh invalidated cache versions',
  );
}

function buildSongdbCacheKey(customerProfileId: string, openkjSystemId: number): string {
  return `cache:songdb:${customerProfileId}:${openkjSystemId}`;
}
