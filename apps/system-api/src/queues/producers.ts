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

export type InvitationJob = {
  organizationUserId: string;
  customerProfileId: string;
  email: string | null;
  invitationToken: string | null;
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

export type QueueProducerSet = {
  invitationProducer: InvitationProducer;
  stripeWebhookProducer: StripeWebhookProducer;
  songIndexProducer: SongIndexProducer;
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

  async function close() {
    await invitationQueue.close();
    await webhookQueue.close();
    await songIndexQueue.close();
  }

  return {
    invitationProducer: new InvitationProducer(invitationQueue),
    stripeWebhookProducer: new StripeWebhookProducer(webhookQueue),
    songIndexProducer: new SongIndexProducer(songIndexQueue),
    close,
  };
}
