import Stripe from 'stripe';

import type { Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';
import type { StripeWebhookProducer } from '../queues/producers';

export type SubscriptionDto = {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  metadata: Record<string, unknown>;
  livemode: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CheckoutSessionInput = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialFromPrice?: boolean;
  metadata?: Record<string, string>;
};

export type CheckoutSessionResult = {
  id: string;
  url: string | null;
  expiresAt: string | null;
};

type SubscriptionServiceOptions = {
  cacheTtlSeconds?: number;
};

export class SubscriptionService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    private readonly stripe: Stripe | null,
    private readonly webhookProducer: StripeWebhookProducer,
    options: SubscriptionServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 120;
  }

  async listSubscriptions(customerProfileId: string): Promise<SubscriptionDto[]> {
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildListCacheKey(customerProfileId, version);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as SubscriptionDto[];
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: 'desc' },
      select: subscriptionSelect,
    });

    const data = subscriptions.map((subscription) => this.mapModelToDto(subscription));
    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);

    return data;
  }

  async createCheckoutSession(
    customerProfileId: string,
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { customerProfileId },
    });

    if (!customer) {
      throw createNotFoundError('Customer billing profile', { customerProfileId });
    }

    if (!this.stripe) {
      throw createValidationError('Stripe integration is not configured.');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.stripeCustomerId,
      line_items: [
        {
          price: input.priceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: {
        customer_profile_id: customerProfileId,
        ...(input.metadata ?? {}),
      },
      subscription_data: input.trialFromPrice
        ? {
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          }
        : undefined,
    });

    await this.prisma.stripeCheckoutSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        customerId: customer.id,
        paymentStatus: session.payment_status ?? 'unpaid',
        mode: session.mode ?? 'subscription',
        amountTotal: session.amount_total ?? null,
        currency: session.currency ?? 'usd',
        url: session.url ?? null,
        metadata: (session.metadata ?? {}) as Prisma.InputJsonValue,
        completedAt: session.completed_at ? new Date(session.completed_at * 1000) : null,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      },
      update: {
        paymentStatus: session.payment_status ?? 'unpaid',
        url: session.url ?? null,
        amountTotal: session.amount_total ?? null,
        currency: session.currency ?? 'usd',
        metadata: (session.metadata ?? {}) as Prisma.InputJsonValue,
        completedAt: session.completed_at ? new Date(session.completed_at * 1000) : null,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      },
    });

    await this.webhookProducer.enqueueCheckoutSync({
      checkoutSessionId: session.id,
      customerProfileId,
    });

    return {
      id: session.id,
      url: session.url ?? null,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    };
  }

  async refreshSubscriptionFromStripe(customerProfileId: string, subscriptionId: string): Promise<void> {
    await this.webhookProducer.enqueueSubscriptionSync({
      customerProfileId,
      subscriptionId,
    });

    await this.bumpCacheVersion(customerProfileId);
  }

  private mapModelToDto(
    model: Prisma.SubscriptionGetPayload<{ select: typeof subscriptionSelect }>,
  ): SubscriptionDto {
    return {
      id: model.id,
      status: model.status,
      currentPeriodStart: model.currentPeriodStart.toISOString(),
      currentPeriodEnd: model.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: model.cancelAtPeriodEnd,
      cancelAt: model.cancelAt ? model.cancelAt.toISOString() : null,
      canceledAt: model.canceledAt ? model.canceledAt.toISOString() : null,
      metadata: normalizeMetadata(model.metadata),
      livemode: model.livemode,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private buildListCacheKey(customerProfileId: string, version: number): string {
    return `cache:subscriptions:${customerProfileId}:v${version}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:subscriptions:${customerProfileId}:version`;
  }

  private async getCacheVersion(customerProfileId: string): Promise<number> {
    const key = this.getCacheVersionKey(customerProfileId);
    const value = await this.redis.get(key);
    return value ? Number(value) : 0;
  }

  private async bumpCacheVersion(customerProfileId: string): Promise<void> {
    const key = this.getCacheVersionKey(customerProfileId);
    await this.redis.incr(key);
  }
}

const subscriptionSelect = {
  id: true,
  status: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  cancelAt: true,
  canceledAt: true,
  metadata: true,
  livemode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionSelect;

function normalizeMetadata(metadata: Prisma.JsonValue): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  return {};
}
