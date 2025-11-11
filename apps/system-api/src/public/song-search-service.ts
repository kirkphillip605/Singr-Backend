import { createHash } from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type { RedisClient } from '../lib/redis';

export type SongSearchParams = {
  query: string;
  customerProfileId?: string;
  openkjSystemId?: number;
  limit?: number;
  offset?: number;
};

export type SongSearchResult = {
  data: SongSearchItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  query: {
    query: string;
    customerProfileId?: string;
    openkjSystemId?: number;
    limit: number;
    offset: number;
  };
};

export type SongSearchItem = {
  id: string;
  customerProfileId: string;
  openkjSystemId: number;
  artist: string;
  title: string;
  combined: string;
};

type SongSearchRow = {
  id: string;
  customerProfileId: string;
  openkjSystemId: number;
  artist: string;
  title: string;
  combined: string;
};

type SongSearchOptions = {
  cacheTtlSeconds?: number;
  defaultLimit?: number;
  maxLimit?: number;
  maxOffset?: number;
};

export class PublicSongSearchService {
  private readonly cacheTtlSeconds: number;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly maxOffset: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: SongSearchOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this.defaultLimit = options.defaultLimit ?? 25;
    this.maxLimit = options.maxLimit ?? 100;
    this.maxOffset = options.maxOffset ?? 1_000;
  }

  async searchSongs(params: SongSearchParams): Promise<SongSearchResult> {
    const normalized = this.normalizeParams(params);
    const version = await this.getCacheVersion();
    const cacheKey = this.buildCacheKey(version, normalized);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SongSearchResult;
    }

    const { rows, total } = await this.fetchSongsFromDatabase(normalized);
    const result: SongSearchResult = {
      data: rows.map((row) => this.mapRowToItem(row)),
      pagination: {
        limit: normalized.limit,
        offset: normalized.offset,
        total,
      },
      query: normalized,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.cacheTtlSeconds);

    return result;
  }

  async invalidateCache(): Promise<void> {
    await this.redis.incr(this.getCacheVersionKey());
  }

  private normalizeParams(params: SongSearchParams): SongSearchResult['query'] {
    const limit = Math.min(Math.max(1, Math.round(params.limit ?? this.defaultLimit)), this.maxLimit);
    const offset = Math.min(Math.max(0, Math.round(params.offset ?? 0)), this.maxOffset);

    const normalizedQuery = normalizeSongValue(params.query);

    return {
      query: normalizedQuery,
      customerProfileId: params.customerProfileId,
      openkjSystemId: params.openkjSystemId,
      limit,
      offset,
    };
  }

  private async fetchSongsFromDatabase(
    params: SongSearchResult['query'],
  ): Promise<{ rows: SongSearchRow[]; total: number }> {
    const like = `%${params.query}%`;

    const conditions: Prisma.Sql[] = [Prisma.sql`s.normalized_combined LIKE ${like}`];

    if (params.customerProfileId) {
      conditions.push(Prisma.sql`s.customer_profiles_id = ${params.customerProfileId}`);
    }

    if (params.openkjSystemId !== undefined) {
      conditions.push(Prisma.sql`s.openkj_system_id = ${params.openkjSystemId}`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<SongSearchRow[]>(Prisma.sql`
      SELECT
        s.songdb_id::text AS "id",
        s.customer_profiles_id AS "customerProfileId",
        s.openkj_system_id AS "openkjSystemId",
        s.artist AS "artist",
        s.title AS "title",
        s.combined AS "combined"
      FROM songdb s
      ${whereClause}
      ORDER BY s.normalized_combined ASC
      LIMIT ${params.limit}
      OFFSET ${params.offset}
    `);

    const countRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM songdb s
      ${whereClause}
    `);

    const total = countRows.length > 0 ? Number(countRows[0]?.count ?? 0) : 0;

    return { rows, total };
  }

  private mapRowToItem(row: SongSearchRow): SongSearchItem {
    return {
      id: row.id,
      customerProfileId: row.customerProfileId,
      openkjSystemId: row.openkjSystemId,
      artist: row.artist,
      title: row.title,
      combined: row.combined,
    };
  }

  private buildCacheKey(version: number, params: SongSearchResult['query']): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
    return `cache:public:songs:search:v${version}:${hash}`;
  }

  private getCacheVersionKey(): string {
    return 'cache:public:songs:search:version';
  }

  private async getCacheVersion(): Promise<number> {
    const raw = await this.redis.get(this.getCacheVersionKey());
    return raw ? Number(raw) : 0;
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
