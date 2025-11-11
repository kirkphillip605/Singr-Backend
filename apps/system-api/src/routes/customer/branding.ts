import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { BrandingService } from '../../customer/branding-service';
import { createValidationError } from '../../http/problem';
import {
  handleRouteError,
  parseBody,
  requireCustomerContext,
} from './utils';

const updateBrandingSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    logoUrl: z.string().url().nullish(),
    colorPalette: z.record(z.string(), z.unknown()).optional(),
    poweredBySingr: z.boolean().optional(),
    domain: z.string().url().nullish(),
    appBundleId: z.string().max(200).nullish(),
    appPackageName: z.string().max(200).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const createAssetSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

type RegisterCustomerBrandingRoutesOptions = {
  config: AppConfig;
  brandingService: BrandingService;
};

export async function registerCustomerBrandingRoutes(
  app: FastifyInstance,
  options: RegisterCustomerBrandingRoutesOptions,
) {
  const { brandingService } = options;

  app.get('/v1/customer/branding', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.branding', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const branding = await brandingService.getBrandingProfile(customerId);
      reply.send({ data: branding });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/customer/branding', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.branding', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(updateBrandingSchema, request.body);
      if (Object.keys(body).length === 0) {
        throw createValidationError('At least one field must be provided to update branding.');
      }

      const branding = await brandingService.updateBrandingProfile(customerId, body);
      reply.send(branding);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/branding/assets', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.branding', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(createAssetSchema, request.body);
      const upload = await brandingService.createSignedUpload(customerId, body);
      reply.code(201).send(upload);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
