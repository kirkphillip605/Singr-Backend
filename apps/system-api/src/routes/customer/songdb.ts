import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { SongdbIngestionService } from '../../customer/songdb-ingestion-service';
import {
  handleRouteError,
  parseBody,
  parseParams,
  requireCustomerContext,
} from './utils';

const importSchema = z.object({
  openkjSystemId: z.coerce.number().int().min(0),
  songs: z
    .array(
      z.object({
        artist: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(1000),
});

const reindexParamsSchema = z.object({
  openkjSystemId: z.coerce.number().int().min(0),
});

type RegisterCustomerSongdbRoutesOptions = {
  config: AppConfig;
  songdbService: SongdbIngestionService;
};

export async function registerCustomerSongdbRoutes(
  app: FastifyInstance,
  options: RegisterCustomerSongdbRoutesOptions,
) {
  const { songdbService } = options;

  app.post('/v1/customer/songdb/import', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.songdb', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(importSchema, request.body);
      const result = await songdbService.ingestSongs(customerId, body.openkjSystemId, body.songs);
      reply.code(202).send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/songdb/:openkjSystemId/reindex', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.songdb', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(reindexParamsSchema, request.params);
      await songdbService.queueIndexRefresh(customerId, params.openkjSystemId);
      reply.code(202).send({ status: 'queued' });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
