import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

function isSentryEnabled() {
  return Boolean(Sentry.getCurrentHub().getClient());
}

export async function withSentryJobScope<T>(job: Job, callback: () => Promise<T>): Promise<T> {
  if (!isSentryEnabled()) {
    return callback();
  }

  return Sentry.runWithAsyncContext(async () => {
    return Sentry.withScope(async (scope) => {
      scope.setTag('queue', job.queueName);
      scope.setTag('job_name', job.name);
      if (job.id) {
        scope.setTag('job_id', job.id);
      }
      scope.setContext('job', {
        id: job.id,
        name: job.name,
        queue: job.queueName,
        attemptsMade: job.attemptsMade,
        opts: job.opts,
      });

      return callback();
    });
  });
}

export function captureWorkerException(error: unknown, job?: Job) {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.captureException(error, {
    tags: job
      ? {
          queue: job.queueName,
          job_name: job.name,
          job_id: job.id ?? undefined,
        }
      : undefined,
    extra: job
      ? {
          jobData: job.data,
          jobAttempts: job.attemptsMade,
        }
      : undefined,
  });
}
