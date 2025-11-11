import type { Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

export type SingerFavoriteSongDto = {
  id: string;
  singerProfileId: string;
  artist: string | null;
  title: string | null;
  keyChange: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type SingerFavoriteVenueDto = {
  singerProfileId: string;
  venueId: string;
  customerProfileId: string;
  name: string;
  city: string;
  state: string;
  acceptingRequests: boolean;
  createdAt: string;
};

export type AddFavoriteSongInput = {
  artist?: string | null;
  title?: string | null;
  keyChange?: number;
  metadata?: Record<string, unknown> | null;
};

type SingerFavoritesServiceOptions = {
  cacheTtlSeconds?: number;
};

export class SingerFavoritesService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: SingerFavoritesServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 120;
  }

  async listFavoriteSongs(singerProfileId: string): Promise<SingerFavoriteSongDto[]> {
    const version = await this.getSongsCacheVersion(singerProfileId);
    const cacheKey = this.buildSongsCacheKey(singerProfileId, version);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SingerFavoriteSongDto[];
    }

    const songs = await this.prisma.singerFavoriteSong.findMany({
      where: { singerProfileId },
      orderBy: { createdAt: 'desc' },
      select: favoriteSongSelect,
    });

    const data = songs.map((song) => this.mapSongToDto(song));
    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);
    return data;
  }

  async addFavoriteSong(
    singerProfileId: string,
    input: AddFavoriteSongInput,
  ): Promise<SingerFavoriteSongDto> {
    const normalizedArtist = input.artist?.trim() ?? null;
    const normalizedTitle = input.title?.trim() ?? null;
    if (!normalizedArtist && !normalizedTitle) {
      throw createValidationError('Artist or title is required to favorite a song.');
    }

    try {
      const created = await this.prisma.singerFavoriteSong.create({
        data: {
          singerProfileId,
          artist: normalizedArtist,
          title: normalizedTitle,
          keyChange: input.keyChange ?? 0,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
        select: favoriteSongSelect,
      });

      await this.bumpSongsCacheVersion(singerProfileId);
      return this.mapSongToDto(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await this.prisma.singerFavoriteSong.findFirst({
          where: {
            singerProfileId,
            artist: normalizedArtist,
            title: normalizedTitle,
            keyChange: input.keyChange ?? 0,
          },
          select: favoriteSongSelect,
        });

        if (existing) {
          return this.mapSongToDto(existing);
        }
      }

      throw error;
    }
  }

  async removeFavoriteSong(singerProfileId: string, favoriteId: string): Promise<void> {
    const existing = await this.prisma.singerFavoriteSong.findFirst({
      where: { id: favoriteId, singerProfileId },
      select: { id: true },
    });

    if (!existing) {
      throw createNotFoundError('Favorite song', { favoriteId });
    }

    await this.prisma.singerFavoriteSong.delete({ where: { id: favoriteId } });
    await this.bumpSongsCacheVersion(singerProfileId);
  }

  async listFavoriteVenues(singerProfileId: string): Promise<SingerFavoriteVenueDto[]> {
    const version = await this.getVenuesCacheVersion(singerProfileId);
    const cacheKey = this.buildVenuesCacheKey(singerProfileId, version);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SingerFavoriteVenueDto[];
    }

    const favorites = await this.prisma.singerFavoriteVenue.findMany({
      where: { singerProfileId },
      include: {
        venue: {
          select: {
            id: true,
            customerProfileId: true,
            name: true,
            city: true,
            state: true,
            acceptingRequests: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = favorites.map((favorite) => ({
      singerProfileId,
      venueId: favorite.venueId,
      customerProfileId: favorite.venue.customerProfileId,
      name: favorite.venue.name,
      city: favorite.venue.city,
      state: favorite.venue.state,
      acceptingRequests: favorite.venue.acceptingRequests,
      createdAt: favorite.createdAt.toISOString(),
    }));

    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);
    return data;
  }

  async addFavoriteVenue(singerProfileId: string, venueId: string): Promise<SingerFavoriteVenueDto> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        customerProfileId: true,
        name: true,
        city: true,
        state: true,
        acceptingRequests: true,
      },
    });

    if (!venue) {
      throw createNotFoundError('Venue', { venueId });
    }

    const favorite = await this.prisma.singerFavoriteVenue.upsert({
      where: {
        singerProfileId_venueId: {
          singerProfileId,
          venueId,
        },
      },
      create: {
        singerProfileId,
        venueId,
      },
      update: {},
      select: {
        createdAt: true,
      },
    });

    await this.bumpVenuesCacheVersion(singerProfileId);

    return {
      singerProfileId,
      venueId,
      customerProfileId: venue.customerProfileId,
      name: venue.name,
      city: venue.city,
      state: venue.state,
      acceptingRequests: venue.acceptingRequests,
      createdAt: favorite.createdAt.toISOString(),
    };
  }

  async removeFavoriteVenue(singerProfileId: string, venueId: string): Promise<void> {
    const existing = await this.prisma.singerFavoriteVenue.findUnique({
      where: {
        singerProfileId_venueId: {
          singerProfileId,
          venueId,
        },
      },
      select: { venueId: true },
    });

    if (!existing) {
      throw createNotFoundError('Favorite venue', { venueId });
    }

    await this.prisma.singerFavoriteVenue.delete({
      where: {
        singerProfileId_venueId: {
          singerProfileId,
          venueId,
        },
      },
    });

    await this.bumpVenuesCacheVersion(singerProfileId);
  }

  private mapSongToDto(
    model: Prisma.SingerFavoriteSongGetPayload<{ select: typeof favoriteSongSelect }>,
  ): SingerFavoriteSongDto {
    return {
      id: model.id,
      singerProfileId: model.singerProfileId,
      artist: model.artist ?? null,
      title: model.title ?? null,
      keyChange: model.keyChange,
      metadata: (model.metadata as Record<string, unknown> | null) ?? null,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private buildSongsCacheKey(singerProfileId: string, version: number) {
    return `cache:singer:favorites:songs:${singerProfileId}:v${version}`;
  }

  private getSongsVersionKey(singerProfileId: string) {
    return `cache:singer:favorites:songs:${singerProfileId}:version`;
  }

  private async getSongsCacheVersion(singerProfileId: string): Promise<number> {
    const raw = await this.redis.get(this.getSongsVersionKey(singerProfileId));
    return raw ? Number(raw) : 0;
  }

  private async bumpSongsCacheVersion(singerProfileId: string): Promise<void> {
    await this.redis.incr(this.getSongsVersionKey(singerProfileId));
  }

  private buildVenuesCacheKey(singerProfileId: string, version: number) {
    return `cache:singer:favorites:venues:${singerProfileId}:v${version}`;
  }

  private getVenuesVersionKey(singerProfileId: string) {
    return `cache:singer:favorites:venues:${singerProfileId}:version`;
  }

  private async getVenuesCacheVersion(singerProfileId: string): Promise<number> {
    const raw = await this.redis.get(this.getVenuesVersionKey(singerProfileId));
    return raw ? Number(raw) : 0;
  }

  private async bumpVenuesCacheVersion(singerProfileId: string): Promise<void> {
    await this.redis.incr(this.getVenuesVersionKey(singerProfileId));
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

const favoriteSongSelect = {
  id: true,
  singerProfileId: true,
  artist: true,
  title: true,
  keyChange: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SingerFavoriteSongSelect;
