import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { OrganizationUserService } from '../../customer/organization-user-service';
import { createValidationError } from '../../http/problem';
import {
  handleRouteError,
  parseBody,
  parseParams,
  requireCustomerContext,
} from './utils';

const inviteSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid().nullish(),
});

const updateSchema = z
  .object({
    roleId: z.string().uuid().nullish(),
    status: z.enum(['invited', 'active', 'suspended', 'revoked']).optional(),
    invitationExpiresAt: z.coerce.date().nullish(),
  })
  .strict();

const paramsSchema = z.object({
  organizationUserId: z.string().uuid(),
});

type RegisterCustomerOrganizationUserRoutesOptions = {
  config: AppConfig;
  organizationUserService: OrganizationUserService;
};

export async function registerCustomerOrganizationUserRoutes(
  app: FastifyInstance,
  options: RegisterCustomerOrganizationUserRoutesOptions,
) {
  const { organizationUserService } = options;

  app.get('/v1/customer/organization-users', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.users', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const users = await organizationUserService.listOrganizationUsers(customerId);
      reply.send({ data: users });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/organization-users', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      const user = request.authorization.requireUser();
      request.authorization.requireOrganizationPermission('customer.users', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(inviteSchema, request.body);
      const invited = await organizationUserService.inviteUser(customerId, {
        userId: body.userId,
        roleId: body.roleId ?? null,
        invitedByUserId: user.id,
      });

      reply.code(201).send(invited);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/customer/organization-users/:organizationUserId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.users', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(paramsSchema, request.params);
      const body = parseBody(updateSchema, request.body);

      if (Object.keys(body).length === 0) {
        throw createValidationError('At least one field must be provided to update an organization user.');
      }

      const updated = await organizationUserService.updateUser(customerId, params.organizationUserId, {
        roleId: body.roleId ?? undefined,
        status: body.status,
        invitationExpiresAt: body.invitationExpiresAt ?? undefined,
      });

      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/customer/organization-users/:organizationUserId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.users', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(paramsSchema, request.params);
      await organizationUserService.removeUser(customerId, params.organizationUserId);
      reply.code(204).send();
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
