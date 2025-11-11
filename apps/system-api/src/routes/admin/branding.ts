import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdminBrandingOversightService } from '../../admin/branding-oversight-service';
import { handleRouteError, parseBody, parseParams, requireGlobalAdmin } from './utils';

const updateBrandingSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'revoked']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const brandingParamsSchema = z.object({
  brandingId: z.string().uuid(),
});

type RegisterAdminBrandingRoutesOptions = {
  brandingService: AdminBrandingOversightService;
};

export async function registerAdminBrandingRoutes(
  app: FastifyInstance,
  options: RegisterAdminBrandingRoutesOptions,
) {
  const { brandingService } = options;

  app.get('/v1/admin/branding/profiles', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const profiles = await brandingService.listBrandingProfiles();
      reply.send({ data: profiles });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/admin/branding/profiles/:brandingId', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(brandingParamsSchema, request.params);
      const body = parseBody(updateBrandingSchema, request.body);

      const updated = await brandingService.updateBrandingProfile(params.brandingId, {
        status: body.status,
        metadata: body.metadata,
      });

      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
