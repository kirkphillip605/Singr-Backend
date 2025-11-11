import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';

import type {
  CheckoutSyncJob,
  SubscriptionSyncJob,
} from '../../queues/producers';
import type { WorkerContext } from '../context';
import { serializeForAudit } from '../utils/audit';

export function createStripeWorker(
  context: WorkerContext,
): Worker<CheckoutSyncJob | SubscriptionSyncJob> {
  const worker = new Worker<CheckoutSyncJob | SubscriptionSyncJob>(
    'stripe-webhooks',
    async (job) => {
      if (!context.stripe) {
        context.logger.warn('Stripe integration not configured; skipping job');
        return;
      }

      if (job.name === 'sync-checkout-session') {
        await processCheckoutSessionJob(context, context.stripe, job.data);
        return;
      }

      if (job.name === 'sync-subscription') {
        await processSubscriptionJob(context, context.stripe, job.data);
        return;
      }

      context.logger.warn({ jobName: job.name }, 'Received unsupported Stripe job');
    },
    {
      connection: context.redis.duplicate(),
      prefix: context.queuePrefix,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, error) => {
    context.logger.error({ err: error, jobId: job?.id }, 'Stripe job failed');
  });

  worker.on('error', (error) => {
    context.logger.error({ err: error }, 'Stripe worker error');
  });

  return worker;
}

async function processCheckoutSessionJob(
  context: WorkerContext,
  stripe: Stripe,
  job: CheckoutSyncJob,
): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(job.checkoutSessionId, {
    expand: ['subscription'],
  });

  const existingSession = await context.prisma.stripeCheckoutSession.findUnique({
    where: { id: session.id },
  });

  let customerId = existingSession?.customerId ?? null;
  if (!customerId) {
    const customer = await context.prisma.customer.findFirst({
      where: { customerProfileId: job.customerProfileId },
    });
    customerId = customer?.id ?? null;
  }

  if (!customerId) {
    context.logger.error(
      { checkoutSessionId: session.id, customerProfileId: job.customerProfileId },
      'Unable to resolve customer for checkout session',
    );
    return;
  }

  const persistence = mapStripeCheckoutSession(session, customerId);

  await context.prisma.stripeCheckoutSession.upsert({
    where: { id: session.id },
    create: persistence.create,
    update: persistence.update,
  });

  const subscriptionId = extractSubscriptionId(session.subscription);
  if (subscriptionId) {
    await processSubscriptionJob(context, stripe, {
      customerProfileId: job.customerProfileId,
      subscriptionId,
    });
  }
}

async function processSubscriptionJob(
  context: WorkerContext,
  stripe: Stripe,
  job: SubscriptionSyncJob,
): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(job.subscriptionId);
  const persistence = mapStripeSubscription(subscription, job.customerProfileId);

  await context.prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUnique({
      where: { id: subscription.id },
    });

    const upserted = await tx.subscription.upsert({
      where: { id: subscription.id },
      create: persistence.create,
      update: persistence.update,
    });

    await tx.auditLog.create({
      data: {
        tableName: 'subscriptions',
        recordId: upserted.id,
        operation: existing ? 'UPDATE' : 'INSERT',
        userId: null,
        oldData: existing ? serializeForAudit(existing) : null,
        newData: serializeForAudit(upserted),
      },
    });
  });

  await context.redis.incr(`cache:subscriptions:${job.customerProfileId}:version`);
}

function mapStripeCheckoutSession(
  session: Stripe.Checkout.Session,
  customerId: string,
): {
  create: Prisma.StripeCheckoutSessionUncheckedCreateInput;
  update: Prisma.StripeCheckoutSessionUncheckedUpdateInput;
} {
  const common = {
    paymentStatus: session.payment_status ?? 'unpaid',
    mode: session.mode ?? 'subscription',
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? 'usd',
    url: session.url ?? null,
    metadata: (session.metadata ?? {}) as Prisma.InputJsonValue,
    completedAt: session.completed_at ? new Date(session.completed_at * 1000) : null,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
  } satisfies Prisma.StripeCheckoutSessionUncheckedUpdateInput;

  return {
    create: {
      id: session.id,
      customerId,
      ...common,
    },
    update: common,
  };
}

function mapStripeSubscription(
  subscription: Stripe.Subscription,
  customerProfileId: string,
): {
  create: Prisma.SubscriptionUncheckedCreateInput;
  update: Prisma.SubscriptionUncheckedUpdateInput;
} {
  const common = {
    status: subscription.status ?? 'incomplete',
    currentPeriodStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000)
      : new Date(),
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : new Date(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    metadata: (subscription.metadata ?? {}) as Prisma.InputJsonValue,
    livemode: Boolean(subscription.livemode),
  } satisfies Prisma.SubscriptionUncheckedUpdateInput;

  return {
    create: {
      id: subscription.id,
      customerProfileId,
      ...common,
    },
    update: common,
  };
}

function extractSubscriptionId(subscription: Stripe.Subscription | string | null | undefined): string | null {
  if (!subscription) {
    return null;
  }

  if (typeof subscription === 'string') {
    return subscription;
  }

  return subscription.id ?? null;
}
