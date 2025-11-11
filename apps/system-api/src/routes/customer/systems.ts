import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { SystemService } from '../../customer/system-service';
import { createNotFoundError, createValidationError } from '../../http/problem';
import { handleRouteError, parseBody, parseParams, requireCustomerContext } from './utils';

type RegisterCustomerSystemRoutesOptions = {
  config: AppConfig;
  systemService: SystemService;
};

const createSystemSchema = z.object({
  openkjSystemId: z.coerce.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

const updateSystemSchema = z.object({
  openkjSystemId: z.coerce.number().int().nonnegative().optional(),
  name: z.string().min(1).max(200).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

const systemParamsSchema = z.object({
  systemId: z.string().uuid(),
});

export async function registerCustomerSystemRoutes(
  app: FastifyInstance,
  options: RegisterCustomerSystemRoutesOptions,
) {
  const { systemService } = options;

  app.get('/v1/customer/systems', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.systems', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const systems = await systemService.listSystems(customerId);
      reply.send({ data: systems });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/systems', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.systems', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(createSystemSchema, request.body);
      const system = await systemService.createSystem(customerId, {
        openkjSystemId: body.openkjSystemId,
        name: body.name.trim(),
        configuration: body.configuration,
      });

      reply.code(201).send(system);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/customer/systems/:systemId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.systems', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(systemParamsSchema, request.params);
      const system = await systemService.getSystem(customerId, params.systemId);

      if (!system) {
        throw createNotFoundError('System', { systemId: params.systemId });
      }

      reply.send(system);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/customer/systems/:systemId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.systems', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(systemParamsSchema, request.params);
      const body = parseBody(updateSystemSchema, request.body);

      if (Object.keys(body).length === 0) {
        throw createValidationError('At least one field must be provided to update a system.');
      }

      const system = await systemService.updateSystem(customerId, params.systemId, body);
      reply.send(system);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/customer/systems/:systemId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.systems', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(systemParamsSchema, request.params);
      await systemService.deleteSystem(customerId, params.systemId);
      reply.code(204).send();
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
