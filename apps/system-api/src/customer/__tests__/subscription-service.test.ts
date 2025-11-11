import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';

import { SubscriptionService } from '../subscription-service';
import type { RedisClient } from '../../lib/redis';
import type { StripeWebhookProducer } from '../../queues/producers';

describe('SubscriptionService', () => {
  const prismaRaw = {
    subscription: {
      findMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    stripeCheckoutSession: {
      upsert: vi.fn(),
    },
  };

  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redisMock = redisRaw as unknown as RedisClient;

  const webhookProducerRaw = {
    enqueueCheckoutSync: vi.fn(),
    enqueueSubscriptionSync: vi.fn(),
  };
  const webhookProducer = webhookProducerRaw as unknown as StripeWebhookProducer;

  let service: SubscriptionService;

  beforeEach(() => {
    service = new SubscriptionService(prismaMock, redisMock, null, webhookProducer, {
      cacheTtlSeconds: 30,
    });
    vi.clearAllMocks();
  });

  it('caches subscription list results', async () => {
    redisRaw.get.mockResolvedValueOnce(null);
    prismaRaw.subscription.findMany.mockResolvedValueOnce([
      {
        id: 'sub_1',
        status: 'active',
        currentPeriodStart: new Date(0),
        currentPeriodEnd: new Date(0),
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        metadata: {},
        livemode: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]);

    const subs = await service.listSubscriptions('cust-1');
    expect(subs).toHaveLength(1);
    expect(redisRaw.set).toHaveBeenCalled();
  });

  it('throws when Stripe is not configured', async () => {
    prismaRaw.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      stripeCustomerId: 'cus_123',
    });

    await expect(
      service.createCheckoutSession('cust-1', {
        priceId: 'price_123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }),
    ).rejects.toThrow('Stripe integration is not configured');
  });

  it('creates checkout session when Stripe is configured', async () => {
    const stripeMock = {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test',
            payment_status: 'unpaid',
            mode: 'subscription',
            amount_total: 1000,
            currency: 'usd',
            url: 'https://checkout.stripe.com/test',
            metadata: {},
            completed_at: null,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        },
      },
    } as unknown as Stripe;

    service = new SubscriptionService(prismaMock, redisMock, stripeMock, webhookProducer, {
      cacheTtlSeconds: 30,
    });

    prismaRaw.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      stripeCustomerId: 'cus_123',
    });

    prismaRaw.stripeCheckoutSession.upsert.mockResolvedValueOnce({});

    const result = await service.createCheckoutSession('cust-1', {
      priceId: 'price_123',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(result.id).toBe('cs_test');
    expect(prismaRaw.stripeCheckoutSession.upsert).toHaveBeenCalled();
    expect(webhookProducerRaw.enqueueCheckoutSync).toHaveBeenCalledWith({
      checkoutSessionId: 'cs_test',
      customerProfileId: 'cust-1',
    });
  });

  it('enqueues subscription sync and bumps cache version', async () => {
    await service.refreshSubscriptionFromStripe('cust-1', 'sub_1');
    expect(webhookProducerRaw.enqueueSubscriptionSync).toHaveBeenCalledWith({
      customerProfileId: 'cust-1',
      subscriptionId: 'sub_1',
    });
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:subscriptions:cust-1:version');
  });
});
