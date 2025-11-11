import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { OpenKjCommandService } from '../../openkj/command-service';
import { handleRouteError, parseBody } from '../customer/utils';

const commandSchema = z.object({
  api_key: z.string().min(1),
  command: z.string().min(1),
  payload: z.unknown().optional(),
});

type RegisterOpenKjRoutesOptions = {
  commandService: OpenKjCommandService;
};

export async function registerOpenKjRoutes(app: FastifyInstance, options: RegisterOpenKjRoutesOptions) {
  const { commandService } = options;

  app.post('/v1/openkj/api/command', async (request, reply) => {
    try {
      const body = parseBody(commandSchema, request.body);
      const result = await commandService.execute({
        apiKey: body.api_key,
        command: body.command,
        payload: body.payload,
      });

      reply.send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
