import type { FastifyInstance } from 'fastify';
import type { Registry } from 'prom-client';

import type { AdminBrandingOversightService } from '../../admin/branding-oversight-service';
import type { AdminOrganizationService } from '../../admin/organization-service';
import type { AdminRoleService } from '../../admin/role-service';
import type { AdminStripeWebhookService } from '../../admin/stripe-webhook-service';
import type { AdminUserService } from '../../admin/user-service';
import { handleRouteError, requireGlobalAdmin } from './utils';
import { registerAdminUserRoutes } from './users';
import { registerAdminOrganizationRoutes } from './organizations';
import { registerAdminRoleRoutes } from './roles';
import { registerAdminBrandingRoutes } from './branding';
import { registerAdminStripeRoutes } from './stripe';

type RegisterAdminRoutesOptions = {
  userService: AdminUserService;
  organizationService: AdminOrganizationService;
  roleService: AdminRoleService;
  brandingService: AdminBrandingOversightService;
  stripeService: AdminStripeWebhookService;
  metricsRegistry: Registry;
};

export async function registerAdminRoutes(app: FastifyInstance, options: RegisterAdminRoutesOptions) {
  await registerAdminUserRoutes(app, { userService: options.userService });
  await registerAdminOrganizationRoutes(app, { organizationService: options.organizationService });
  await registerAdminRoleRoutes(app, { roleService: options.roleService });
  await registerAdminBrandingRoutes(app, { brandingService: options.brandingService });
  await registerAdminStripeRoutes(app, { stripeService: options.stripeService });

  app.get('/v1/admin/metrics', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      reply.header('content-type', options.metricsRegistry.contentType);
      const metrics = await options.metricsRegistry.metrics();
      reply.send(metrics);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
