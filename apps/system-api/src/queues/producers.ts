import { Queue } from 'bullmq';

import type { RedisClient } from '../lib/redis';

export type QueueProducerConfig = {
  prefix?: string;
};

export class InvitationProducer {
  constructor(private readonly queue: Queue<InvitationJob>) {}

  async enqueueInvitation(job: InvitationJob): Promise<void> {
    await this.queue.add('send-invitation', job, {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class StripeWebhookProducer {
  constructor(private readonly queue: Queue<CheckoutSyncJob | SubscriptionSyncJob>) {}

  async enqueueCheckoutSync(job: CheckoutSyncJob): Promise<void> {
    await this.queue.add('sync-checkout-session', job, {
      removeOnComplete: true,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  async enqueueSubscriptionSync(job: SubscriptionSyncJob): Promise<void> {
    await this.queue.add('sync-subscription', job, {
      removeOnComplete: true,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class SongIndexProducer {
  constructor(private readonly queue: Queue<SongIndexRefreshJob>) {}

  async enqueueRefresh(job: SongIndexRefreshJob): Promise<void> {
    await this.queue.add('refresh-song-index', job, {
      removeOnComplete: true,
      attempts: 3,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class SingerRequestNotificationProducer {
  constructor(private readonly queue: Queue<SingerRequestNotificationJob>) {}

  async enqueueRequestNotification(job: SingerRequestNotificationJob): Promise<void> {
    await this.queue.add('dispatch-singer-request-notification', job, {
      removeOnComplete: true,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class CleanupProducer {
  constructor(private readonly queue: Queue<CleanupJob>) {}

  async enqueue(job: CleanupJob, opts: { repeat?: { every?: number; pattern?: string } } = {}): Promise<void> {
    await this.queue.add(job.task, job, {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'fixed', delay: 5_000 },
      repeat: opts.repeat,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class BrandingScanProducer {
  constructor(private readonly queue: Queue<BrandingScanJob>) {}

  async enqueue(job: BrandingScanJob, opts: { repeat?: { every?: number; pattern?: string } } = {}): Promise<void> {
    await this.queue.add('branding-scan', job, {
      removeOnComplete: true,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      repeat: opts.repeat,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export type InvitationJob = {
  organizationUserId: string;
  customerProfileId: string;
  email: string | null;
  invitationToken: string | null;
  invitationExpiresAt: string | null;
};

export type CheckoutSyncJob = {
  customerProfileId: string;
  checkoutSessionId: string;
};

export type SubscriptionSyncJob = {
  customerProfileId: string;
  subscriptionId: string;
};

export type SongIndexRefreshJob = {
  customerProfileId: string;
  openkjSystemId: number;
};

export type SingerRequestNotificationJob = {
  requestId: string;
  singerProfileId: string;
  userId: string;
  venueId: string;
  customerProfileId: string;
  artist: string;
  title: string;
  keyChange: number;
  notes: string | null;
  requestedAt: string;
};

export type CleanupJob =
  | { task: 'expire-organization-invitations' }
  | { task: 'prune-stripe-webhook-events'; olderThanDays?: number };

export type BrandingScanJob = {
  task: 'branding-profile-health-check';
  customerProfileId?: string | null;
};

export type QueueProducerSet = {
  invitationProducer: InvitationProducer;
  stripeWebhookProducer: StripeWebhookProducer;
  songIndexProducer: SongIndexProducer;
  singerRequestProducer: SingerRequestNotificationProducer;
  cleanupProducer: CleanupProducer;
  brandingScanProducer: BrandingScanProducer;
  close: () => Promise<void>;
};

export function createQueueProducers(
  redis: RedisClient,
  config: QueueProducerConfig = {},
): QueueProducerSet {
  const prefix = config.prefix ?? 'bull';

  const invitationQueue = new Queue<InvitationJob>('customer-organization-invitations', {
    connection: redis.duplicate(),
    prefix,
  });

  const webhookQueue = new Queue<CheckoutSyncJob | SubscriptionSyncJob>('stripe-webhooks', {
    connection: redis.duplicate(),
    prefix,
  });

  const songIndexQueue = new Queue<SongIndexRefreshJob>('songdb-index-refresh', {
    connection: redis.duplicate(),
    prefix,
  });

  const singerRequestQueue = new Queue<SingerRequestNotificationJob>('singer-request-notifications', {
    connection: redis.duplicate(),
    prefix,
  });

  const cleanupQueue = new Queue<CleanupJob>('system-maintenance', {
    connection: redis.duplicate(),
    prefix,
  });

  const brandingScanQueue = new Queue<BrandingScanJob>('branding-scan', {
    connection: redis.duplicate(),
    prefix,
  });

  async function close() {
    await invitationQueue.close();
    await webhookQueue.close();
    await songIndexQueue.close();
    await singerRequestQueue.close();
    await cleanupQueue.close();
    await brandingScanQueue.close();
  }

  return {
    invitationProducer: new InvitationProducer(invitationQueue),
    stripeWebhookProducer: new StripeWebhookProducer(webhookQueue),
    songIndexProducer: new SongIndexProducer(songIndexQueue),
    singerRequestProducer: new SingerRequestNotificationProducer(singerRequestQueue),
    cleanupProducer: new CleanupProducer(cleanupQueue),
    brandingScanProducer: new BrandingScanProducer(brandingScanQueue),
    close,
  };
}
