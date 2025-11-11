import type { Prisma, PrismaClient } from '@prisma/client';

import type { RedisClient } from '../lib/redis';

export type SingerRequestHistoryDto = {
  id: string;
  singerProfileId: string;
  venueId: string;
  artist: string;
  title: string;
  keyChange: number;
  requestedAt: string;
  songFingerprint: string;
  venue: {
    customerProfileId: string;
    name: string;
    city: string;
    state: string;
    acceptingRequests: boolean;
  };
};

export type SingerHistoryListParams = {
  limit?: number;
};

type SingerHistoryServiceOptions = {
  cacheTtlSeconds?: number;
};

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export class SingerHistoryService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: SingerHistoryServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 60;
  }

  async listHistory(
    singerProfileId: string,
    params: SingerHistoryListParams = {},
  ): Promise<SingerRequestHistoryDto[]> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const version = await this.getCacheVersion(singerProfileId);
    const cacheKey = this.buildCacheKey(singerProfileId, version, limit);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SingerRequestHistoryDto[];
    }

    const history = await this.prisma.singerRequestHistory.findMany({
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
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });

    const data = history.map((entry) => ({
      id: entry.id,
      singerProfileId: entry.singerProfileId,
      venueId: entry.venueId,
      artist: entry.artist,
      title: entry.title,
      keyChange: entry.keyChange,
      requestedAt: entry.requestedAt.toISOString(),
      songFingerprint: entry.songFingerprint,
      venue: {
        customerProfileId: entry.venue.customerProfileId,
        name: entry.venue.name,
        city: entry.venue.city,
        state: entry.venue.state,
        acceptingRequests: entry.venue.acceptingRequests,
      },
    }));

    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);
    return data;
  }

  async createHistoryEntry(
    tx: PrismaTx,
    input: CreateHistoryEntryInput,
  ): Promise<void> {
    await tx.singerRequestHistory.create({
      data: {
        singerProfileId: input.singerProfileId,
        venueId: input.venueId,
        artist: input.artist,
        title: input.title,
        keyChange: input.keyChange,
        requestedAt: input.requestedAt,
        songFingerprint: input.songFingerprint,
      },
    });
  }

  async bumpCacheVersion(singerProfileId: string): Promise<void> {
    await this.redis.incr(this.getVersionKey(singerProfileId));
  }

  private buildCacheKey(singerProfileId: string, version: number, limit: number) {
    return `cache:singer:history:${singerProfileId}:v${version}:limit${limit}`;
  }

  private getVersionKey(singerProfileId: string) {
    return `cache:singer:history:${singerProfileId}:version`;
  }

  private async getCacheVersion(singerProfileId: string): Promise<number> {
    const raw = await this.redis.get(this.getVersionKey(singerProfileId));
    return raw ? Number(raw) : 0;
  }
}

export type CreateHistoryEntryInput = {
  singerProfileId: string;
  venueId: string;
  artist: string;
  title: string;
  keyChange: number;
  requestedAt: Date;
  songFingerprint: string;
};
