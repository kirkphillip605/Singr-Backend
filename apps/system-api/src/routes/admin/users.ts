import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AdminUserService } from '../../admin/user-service';
import { handleRouteError, parseBody, parseParams, requireGlobalAdmin } from './utils';

const updateUserRolesSchema = z.object({
  roles: z.array(z.string().min(1)).max(20),
});

const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

type RegisterAdminUserRoutesOptions = {
  userService: AdminUserService;
};

export async function registerAdminUserRoutes(
  app: FastifyInstance,
  options: RegisterAdminUserRoutesOptions,
) {
  const { userService } = options;

  app.get('/v1/admin/users', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const users = await userService.listUsers();
      reply.send({ data: users });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.put('/v1/admin/users/:userId/roles', async (request, reply) => {
    try {
      requireGlobalAdmin(request);

      const params = parseParams(userParamsSchema, request.params);
      const body = parseBody(updateUserRolesSchema, request.body);

      const updated = await userService.updateUserRoles(params.userId, body.roles);
      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
