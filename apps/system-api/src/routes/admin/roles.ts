import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdminRoleService } from '../../admin/role-service';
import { handleRouteError, parseBody, parseParams, requireGlobalAdmin } from './utils';

const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)).max(100),
});

const roleParamsSchema = z.object({
  roleId: z.string().uuid(),
});

type RegisterAdminRoleRoutesOptions = {
  roleService: AdminRoleService;
};

export async function registerAdminRoleRoutes(app: FastifyInstance, options: RegisterAdminRoleRoutesOptions) {
  const { roleService } = options;

  app.get('/v1/admin/roles', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const roles = await roleService.listRoles();
      reply.send({ data: roles });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.put('/v1/admin/roles/:roleId/permissions', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(roleParamsSchema, request.params);
      const body = parseBody(updateRolePermissionsSchema, request.body);

      const updated = await roleService.updateRolePermissions(params.roleId, body.permissions);
      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
