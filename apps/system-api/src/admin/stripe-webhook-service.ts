import type Stripe from 'stripe';
import type { PrismaClient, StripeWebhookEvent } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';

export type AdminStripeWebhookEventDto = {
  id: number;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt: string | null;
  receivedAt: string;
  livemode: boolean;
  errorMessage: string | null;
  requestId: string | null;
  endpointSecret: string | null;
};

export type ListStripeWebhookEventsInput = {
  limit?: number;
  eventType?: string;
  processed?: boolean;
};

export class AdminStripeWebhookService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stripe: Stripe | null,
  ) {}

  async listEvents(input: ListStripeWebhookEventsInput = {}): Promise<AdminStripeWebhookEventDto[]> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);

    const events = await this.prisma.stripeWebhookEvent.findMany({
      where: {
        eventType: input.eventType ? { equals: input.eventType } : undefined,
        processed: input.processed,
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });

    return events.map((event) => this.mapEvent(event));
  }

  async getEvent(eventId: string): Promise<AdminStripeWebhookEventDto> {
    const event = await this.prisma.stripeWebhookEvent.findUnique({
      where: { eventId },
    });

    if (!event) {
      throw createNotFoundError('Stripe webhook event', { eventId });
    }

    return this.mapEvent(event);
  }

  async retrieveRemoteEvent(eventId: string): Promise<Stripe.Event> {
    if (!this.stripe) {
      throw createValidationError('Stripe client is not configured.');
    }

    return this.stripe.events.retrieve(eventId);
  }

  private mapEvent(event: StripeWebhookEvent): AdminStripeWebhookEventDto {
    return {
      id: event.id,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: normalizeJson(event.payload),
      processed: event.processed,
      processedAt: event.processedAt ? event.processedAt.toISOString() : null,
      receivedAt: event.receivedAt.toISOString(),
      livemode: event.livemode,
      errorMessage: event.errorMessage ?? null,
      requestId: event.requestId ?? null,
      endpointSecret: event.endpointSecret ?? null,
    };
  }
}

function normalizeJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
