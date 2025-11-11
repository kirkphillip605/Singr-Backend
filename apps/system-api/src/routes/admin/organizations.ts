import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdminOrganizationService } from '../../admin/organization-service';
import { createValidationError } from '../../http/problem';
import { handleRouteError, parseBody, parseParams, requireGlobalAdmin } from './utils';

const updateOrganizationSchema = z
  .object({
    legalBusinessName: z.string().max(200).nullish(),
    dbaName: z.string().max(200).nullish(),
    contactEmail: z.string().email().nullish(),
    contactPhone: z.string().max(50).nullish(),
    timezone: z.string().max(100).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const organizationParamsSchema = z.object({
  organizationId: z.string().uuid(),
});

type RegisterAdminOrganizationRoutesOptions = {
  organizationService: AdminOrganizationService;
};

export async function registerAdminOrganizationRoutes(
  app: FastifyInstance,
  options: RegisterAdminOrganizationRoutesOptions,
) {
  const { organizationService } = options;

  app.get('/v1/admin/organizations', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const organizations = await organizationService.listOrganizations();
      reply.send({ data: organizations });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/admin/organizations/:organizationId', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(organizationParamsSchema, request.params);
      const body = parseBody(updateOrganizationSchema, request.body);

      const providedFields = Object.entries(body).filter(([, value]) => value !== undefined);
      if (providedFields.length === 0) {
        throw createValidationError('At least one field must be provided to update an organization.');
      }

      const updated = await organizationService.updateOrganization(params.organizationId, {
        legalBusinessName: body.legalBusinessName ?? undefined,
        dbaName: body.dbaName ?? undefined,
        contactEmail: body.contactEmail ?? undefined,
        contactPhone: body.contactPhone ?? undefined,
        timezone: body.timezone ?? undefined,
        metadata: body.metadata,
      });

      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
