import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { SubscriptionService } from '../../customer/subscription-service';
import {
  handleRouteError,
  parseBody,
  parseParams,
  requireCustomerContext,
} from './utils';

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  trialFromPrice: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const subscriptionParamsSchema = z.object({
  subscriptionId: z.string().min(1),
});

type RegisterCustomerSubscriptionRoutesOptions = {
  config: AppConfig;
  subscriptionService: SubscriptionService;
};

export async function registerCustomerSubscriptionRoutes(
  app: FastifyInstance,
  options: RegisterCustomerSubscriptionRoutesOptions,
) {
  const { subscriptionService } = options;

  app.get('/v1/customer/subscriptions', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.billing', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const subscriptions = await subscriptionService.listSubscriptions(customerId);
      reply.send({ data: subscriptions });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/subscriptions/checkout', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.billing', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(checkoutSchema, request.body);
      const session = await subscriptionService.createCheckoutSession(customerId, body);
      reply.code(201).send(session);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/subscriptions/:subscriptionId/sync', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.billing', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(subscriptionParamsSchema, request.params);

      await subscriptionService.refreshSubscriptionFromStripe(customerId, params.subscriptionId);
      reply.code(202).send({ status: 'queued' });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
