import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdminStripeWebhookService } from '../../admin/stripe-webhook-service';
import { handleRouteError, parseParams, parseQuery, requireGlobalAdmin } from './utils';

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    eventType: z.string().min(1).optional(),
    processed: z
      .string()
      .transform((value) => value === 'true')
      .optional(),
  })
  .partial()
  .strict();

const eventParamsSchema = z.object({
  eventId: z.string().min(1),
});

type RegisterAdminStripeRoutesOptions = {
  stripeService: AdminStripeWebhookService;
};

export async function registerAdminStripeRoutes(
  app: FastifyInstance,
  options: RegisterAdminStripeRoutesOptions,
) {
  const { stripeService } = options;

  app.get('/v1/admin/stripe/webhooks', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const query = parseQuery(listQuerySchema, request.query);
      const events = await stripeService.listEvents({
        limit: query.limit,
        eventType: query.eventType,
        processed: query.processed,
      });

      reply.send({ data: events });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/admin/stripe/webhooks/:eventId', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(eventParamsSchema, request.params);
      const event = await stripeService.getEvent(params.eventId);
      reply.send(event);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/admin/stripe/webhooks/:eventId/remote', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(eventParamsSchema, request.params);
      const event = await stripeService.retrieveRemoteEvent(params.eventId);
      reply.send(event);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
