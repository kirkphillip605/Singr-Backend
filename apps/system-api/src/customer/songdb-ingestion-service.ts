import type { Prisma, PrismaClient } from '@prisma/client';

import { createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';
import type { SongIndexProducer } from '../queues/producers';

export type SongRecordInput = {
  artist: string;
  title: string;
};

type SongdbServiceOptions = {
  cacheTtlSeconds?: number;
};

export class SongdbIngestionService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    private readonly songIndexProducer: SongIndexProducer,
    options: SongdbServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 60;
  }

  async ingestSongs(
    customerProfileId: string,
    openkjSystemId: number,
    songs: SongRecordInput[],
  ): Promise<{ inserted: number }> {
    if (!Array.isArray(songs) || songs.length === 0) {
      throw createValidationError('At least one song must be provided for ingestion.');
    }

    const prepared = songs
      .map((song) => ({
        artist: song.artist?.trim() ?? '',
        title: song.title?.trim() ?? '',
      }))
      .filter((song) => song.artist.length > 0 && song.title.length > 0)
      .map((song) => {
        const combined = `${song.artist} - ${song.title}`;
        const normalizedCombined = normalizeSongValue(`${song.artist} ${song.title}`);

        return {
          customerProfileId,
          openkjSystemId,
          artist: song.artist,
          title: song.title,
          combined,
          normalizedCombined,
        } satisfies Prisma.SongDbCreateManyInput;
      });

    if (prepared.length === 0) {
      throw createValidationError('All song entries were empty after normalization.');
    }

    const result = await this.prisma.songDb.createMany({
      data: prepared,
      skipDuplicates: true,
    });

    await this.redis.set(
      this.buildCacheKey(customerProfileId, openkjSystemId),
      Date.now().toString(),
      'EX',
      this.cacheTtlSeconds,
    );

    await this.bumpCacheVersion(customerProfileId, openkjSystemId);
    await this.redis.incr('cache:public:songs:search:version');

    await this.queueIndexRefresh(customerProfileId, openkjSystemId);

    return { inserted: result.count };
  }

  async queueIndexRefresh(customerProfileId: string, openkjSystemId: number): Promise<void> {
    await this.songIndexProducer.enqueueRefresh({
      customerProfileId,
      openkjSystemId,
    });
  }

  private buildCacheKey(customerProfileId: string, openkjSystemId: number): string {
    return `cache:songdb:${customerProfileId}:${openkjSystemId}`;
  }

  private async bumpCacheVersion(customerProfileId: string, openkjSystemId: number): Promise<void> {
    const key = `${this.buildCacheKey(customerProfileId, openkjSystemId)}:version`;
    await this.redis.incr(key);
  }
}

function normalizeSongValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
