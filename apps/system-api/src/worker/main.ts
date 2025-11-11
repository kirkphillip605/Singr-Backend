import { Queue, QueueScheduler } from 'bullmq';
import Stripe from 'stripe';

import { getConfig } from '../config';
import { createLogger } from '../lib/logger';
import type { AppLogger } from '../lib/logger';
import { createPrismaClient } from '../lib/prisma';
import { createRedisClient } from '../lib/redis';
import { initSentry } from '../observability/sentry';
import type { CleanupJob, BrandingScanJob } from '../queues/producers';
import { createEmailWorker } from './processors/email';
import { createStripeWorker } from './processors/stripe';
import { createSongIndexWorker } from './processors/song-index';
import { createCleanupWorker } from './processors/cleanup';
import { createBrandingScanWorker } from './processors/branding';
import { createEmailProvider } from './email/provider';
import { EmailService } from './email/service';
import type { WorkerContext } from './context';

const QUEUE_PREFIX = 'bull';

export async function bootstrapWorker() {
  const config = getConfig();
  initSentry(config);

  const logger = createLogger(config);
  const redis = createRedisClient(config);
  await redis.connect();

  const prisma = createPrismaClient({ config });
  await prisma.$connect();

  const stripe = config.stripe.apiKey
    ? new Stripe(config.stripe.apiKey, { apiVersion: '2024-04-10' as const })
    : null;

  const emailProvider = createEmailProvider(config, logger);
  const emailService = new EmailService(emailProvider, config, logger);

  const context: WorkerContext = {
    config,
    logger,
    prisma,
    redis,
    emailService,
    stripe,
    queuePrefix: QUEUE_PREFIX,
  };

  const schedulers = await initializeSchedulers(redis);
  const workers = initializeWorkers(context);
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));
  const maintenanceQueues = await initializeMaintenanceQueues(redis);

  await scheduleMaintenanceJobs(maintenanceQueues.cleanupQueue, maintenanceQueues.brandingQueue, logger);

  logger.info('Singr worker started and ready to process jobs');

  const shutdown = async (signal?: NodeJS.Signals) => {
    logger.info({ signal }, 'Received shutdown signal for worker');

    await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled(schedulers.map((scheduler) => scheduler.close()));
    await Promise.allSettled([
      maintenanceQueues.cleanupQueue.close(),
      maintenanceQueues.brandingQueue.close(),
    ]);
    await emailService.close();
    await prisma.$disconnect();
    await redis.quit();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { workers, schedulers, shutdown };
}

async function initializeSchedulers(redis: ReturnType<typeof createRedisClient>) {
  const schedulers = [
    new QueueScheduler('customer-organization-invitations', {
      connection: redis.duplicate(),
      prefix: QUEUE_PREFIX,
    }),
    new QueueScheduler('stripe-webhooks', {
      connection: redis.duplicate(),
      prefix: QUEUE_PREFIX,
    }),
    new QueueScheduler('songdb-index-refresh', {
      connection: redis.duplicate(),
      prefix: QUEUE_PREFIX,
    }),
    new QueueScheduler('system-maintenance', {
      connection: redis.duplicate(),
      prefix: QUEUE_PREFIX,
    }),
    new QueueScheduler('branding-scan', {
      connection: redis.duplicate(),
      prefix: QUEUE_PREFIX,
    }),
  ];

  await Promise.all(schedulers.map((scheduler) => scheduler.waitUntilReady()));

  return schedulers;
}

function initializeWorkers(context: WorkerContext) {
  return [
    createEmailWorker(context),
    createStripeWorker(context),
    createSongIndexWorker(context),
    createCleanupWorker(context),
    createBrandingScanWorker(context),
  ];
}

async function initializeMaintenanceQueues(redis: ReturnType<typeof createRedisClient>) {
  const cleanupQueue = new Queue<CleanupJob>('system-maintenance', {
    connection: redis.duplicate(),
    prefix: QUEUE_PREFIX,
  });

  const brandingQueue = new Queue<BrandingScanJob>('branding-scan', {
    connection: redis.duplicate(),
    prefix: QUEUE_PREFIX,
  });

  await Promise.all([cleanupQueue.waitUntilReady(), brandingQueue.waitUntilReady()]);

  return { cleanupQueue, brandingQueue };
}

async function scheduleMaintenanceJobs(
  cleanupQueue: Queue<CleanupJob>,
  brandingQueue: Queue<BrandingScanJob>,
  logger: AppLogger,
): Promise<void> {
  await addRepeatableJob(
    cleanupQueue,
    logger,
    'expire-organization-invitations',
    { task: 'expire-organization-invitations' },
    {
      jobId: 'expire-organization-invitations',
      repeat: { every: 60 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  await addRepeatableJob(
    cleanupQueue,
    logger,
    'prune-stripe-webhook-events',
    { task: 'prune-stripe-webhook-events', olderThanDays: 30 },
    {
      jobId: 'prune-stripe-webhook-events',
      repeat: { every: 24 * 60 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  await addRepeatableJob(
    brandingQueue,
    logger,
    'branding-scan',
    { task: 'branding-profile-health-check' },
    {
      jobId: 'branding-profile-health-check',
      repeat: { every: 6 * 60 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

async function addRepeatableJob<T>(
  queue: Queue<T>,
  logger: AppLogger,
  name: string,
  data: T,
  options: Parameters<Queue<T>['add']>[2],
) {
  try {
    await queue.add(name, data, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('jobId')) {
      logger.debug({ jobName: name }, 'Repeatable job already scheduled; skipping add');
      return;
    }

    throw error;
  }
}

if (require.main === module) {
  bootstrapWorker().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to bootstrap Singr worker', error);
    process.exitCode = 1;
  });
}
