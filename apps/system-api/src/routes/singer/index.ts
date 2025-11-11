import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SingerFavoritesService } from '../../singer/favorites-service';
import type { SingerHistoryService } from '../../singer/history-service';
import type { SingerProfileService } from '../../singer/profile-service';
import type { SingerRequestService } from '../../singer/request-service';
import {
  handleRouteError,
  parseBody,
  parseParams,
  parseQuery,
  requireSingerContext,
} from './utils';

type RegisterSingerRoutesOptions = {
  profileService: SingerProfileService;
  requestService: SingerRequestService;
  favoritesService: SingerFavoritesService;
  historyService: SingerHistoryService;
};

const updateProfileSchema = z.object({
  nickname: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().max(240).optional().nullable(),
  preferences: z.record(z.any()).optional().nullable(),
});

const createRequestSchema = z.object({
  venueId: z.string().uuid(),
  artist: z.string().min(1).max(240),
  title: z.string().min(1).max(240),
  keyChange: z.coerce.number().int().min(-12).max(12).optional(),
  notes: z.string().max(500).optional().nullable(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const favoriteSongSchema = z.object({
  artist: z.string().max(240).optional().nullable(),
  title: z.string().max(240).optional().nullable(),
  keyChange: z.coerce.number().int().min(-12).max(12).optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

const favoriteSongParamsSchema = z.object({
  favoriteId: z.string().uuid(),
});

const favoriteVenueSchema = z.object({
  venueId: z.string().uuid(),
});

const favoriteVenueParamsSchema = z.object({
  venueId: z.string().uuid(),
});

export async function registerSingerRoutes(app: FastifyInstance, options: RegisterSingerRoutesOptions) {
  const { profileService, requestService, favoritesService, historyService } = options;

  app.get('/v1/singer/profile', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const profile = await profileService.requireProfile(singerProfileId);
      reply.send(profile);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/singer/profile', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const body = parseBody(updateProfileSchema, request.body);

      const updated = await profileService.updateProfile(singerProfileId, {
        nickname: body.nickname,
        avatarUrl: body.avatarUrl ?? undefined,
        preferences: body.preferences ?? undefined,
      });

      request.log.info({ singerProfileId }, 'Singer profile updated');
      reply.send(updated);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/singer/requests', async (request, reply) => {
    try {
      const { singerProfileId, userId } = requireSingerContext(request);
      const body = parseBody(createRequestSchema, request.body);

      const result = await requestService.createRequest(singerProfileId, {
        venueId: body.venueId,
        artist: body.artist.trim(),
        title: body.title.trim(),
        keyChange: body.keyChange,
        notes: body.notes ?? null,
        submittedByUserId: userId,
      });

      request.log.info({ singerProfileId, venueId: body.venueId }, 'Singer request submitted');
      reply.code(201).send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/singer/favorites/songs', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const favorites = await favoritesService.listFavoriteSongs(singerProfileId);
      reply.send(favorites);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/singer/favorites/songs', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const body = parseBody(favoriteSongSchema, request.body);

      const favorite = await favoritesService.addFavoriteSong(singerProfileId, {
        artist: body.artist ?? null,
        title: body.title ?? null,
        keyChange: body.keyChange,
        metadata: body.metadata ?? undefined,
      });

      request.log.info({ singerProfileId, favoriteSongId: favorite.id }, 'Singer favorite song added');
      reply.code(201).send(favorite);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/singer/favorites/songs/:favoriteId', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const params = parseParams(favoriteSongParamsSchema, request.params);

      await favoritesService.removeFavoriteSong(singerProfileId, params.favoriteId);
      request.log.info({ singerProfileId, favoriteSongId: params.favoriteId }, 'Singer favorite song removed');
      reply.code(204).send();
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/singer/favorites/venues', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const favorites = await favoritesService.listFavoriteVenues(singerProfileId);
      reply.send(favorites);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/singer/favorites/venues', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const body = parseBody(favoriteVenueSchema, request.body);

      const favorite = await favoritesService.addFavoriteVenue(singerProfileId, body.venueId);
      request.log.info({ singerProfileId, venueId: body.venueId }, 'Singer favorite venue added');
      reply.code(201).send(favorite);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/singer/favorites/venues/:venueId', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const params = parseParams(favoriteVenueParamsSchema, request.params);

      await favoritesService.removeFavoriteVenue(singerProfileId, params.venueId);
      request.log.info({ singerProfileId, venueId: params.venueId }, 'Singer favorite venue removed');
      reply.code(204).send();
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/singer/history', async (request, reply) => {
    try {
      const { singerProfileId } = requireSingerContext(request);
      const query = parseQuery(historyQuerySchema, request.query);

      const history = await historyService.listHistory(singerProfileId, {
        limit: query.limit,
      });

      reply.send(history);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}
