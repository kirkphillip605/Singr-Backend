import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { ApiKeyService } from '../../customer/api-key-service';
import { createValidationError } from '../../http/problem';
import {
  handleRouteError,
  parseBody,
  parseParams,
  requireCustomerContext,
} from './utils';

const createApiKeySchema = z.object({
  description: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  customerId: z.string().uuid().nullish(),
});

const updateApiKeySchema = z.object({
  description: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const apiKeyParamsSchema = z.object({
  apiKeyId: z.string().uuid(),
});

type RegisterCustomerApiKeyRoutesOptions = {
  config: AppConfig;
  apiKeyService: ApiKeyService;
};

export async function registerCustomerApiKeyRoutes(
  app: FastifyInstance,
  options: RegisterCustomerApiKeyRoutesOptions,
) {
  const { apiKeyService } = options;

  app.get('/v1/customer/api-keys', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.api-keys', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const apiKeys = await apiKeyService.listApiKeys(customerId);
      reply.send({ data: apiKeys });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/api-keys', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      const user = request.authorization.requireUser();
      request.authorization.requireOrganizationPermission('customer.api-keys', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(createApiKeySchema, request.body);
      const result = await apiKeyService.createApiKey(customerId, {
        description: body.description?.trim() ?? null,
        metadata: body.metadata,
        customerId: body.customerId ?? null,
        createdByUserId: user.id,
      });

      reply.code(201).send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/customer/api-keys/:apiKeyId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.api-keys', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(apiKeyParamsSchema, request.params);
      const body = parseBody(updateApiKeySchema, request.body);

      if (Object.keys(body).length === 0) {
        throw createValidationError('At least one field must be provided to update an API key.');
      }

      const apiKey = await apiKeyService.updateApiKey(customerId, params.apiKeyId, {
        description: body.description ?? undefined,
        metadata: body.metadata,
      });

      reply.send(apiKey);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/customer/api-keys/:apiKeyId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.api-keys', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(apiKeyParamsSchema, request.params);
      const apiKey = await apiKeyService.revokeApiKey(customerId, params.apiKeyId);

      reply.send(apiKey);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
