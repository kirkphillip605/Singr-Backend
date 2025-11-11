import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { BrandingService } from '../../customer/branding-service';
import type { PublicSongSearchService } from '../../public/song-search-service';
import type { PublicVenueSearchService } from '../../public/venue-search-service';
import { handleRouteError, parseQuery } from '../customer/utils';

const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(1).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  acceptingRequests: z.coerce.boolean().optional(),
  customerId: z.string().uuid().optional(),
});

const songSearchQuerySchema = z.object({
  q: z.string().min(1),
  customerId: z.string().uuid().optional(),
  openkjSystemId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000).optional(),
});

type RegisterPublicRoutesOptions = {
  venueSearchService: PublicVenueSearchService;
  songSearchService: PublicSongSearchService;
  brandingService: BrandingService;
};

export async function registerPublicRoutes(app: FastifyInstance, options: RegisterPublicRoutesOptions) {
  const { venueSearchService, songSearchService, brandingService } = options;

  app.get('/v1/public/venues/nearby', async (request, reply) => {
    try {
      const query = parseQuery(nearbyQuerySchema, request.query);
      const result = await venueSearchService.searchNearby({
        latitude: query.latitude,
        longitude: query.longitude,
        radiusMeters: query.radius,
        limit: query.limit,
        acceptingRequests: query.acceptingRequests,
        customerProfileId: query.customerId,
      });

      reply.send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/public/songs/search', async (request, reply) => {
    try {
      const query = parseQuery(songSearchQuerySchema, request.query);
      const result = await songSearchService.searchSongs({
        query: query.q,
        customerProfileId: query.customerId,
        openkjSystemId: query.openkjSystemId,
        limit: query.limit,
        offset: query.offset,
      });

      reply.send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/public/branding/platform', async (_request, reply) => {
    try {
      const branding = await brandingService.getPlatformBrandingProfile();
      reply.send({ data: branding });
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
