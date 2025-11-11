import { createHash } from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type { RedisClient } from '../lib/redis';

export type NearbyVenueSearchParams = {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  limit?: number;
  acceptingRequests?: boolean;
  customerProfileId?: string;
};

export type NearbyVenueDto = {
  id: string;
  customerProfileId: string;
  openkjVenueId: number;
  urlName: string;
  acceptingRequests: boolean;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string | null;
  phoneNumber: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number;
};

export type NearbyVenueSearchResult = {
  data: NearbyVenueDto[];
  query: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit: number;
    acceptingRequests?: boolean;
    customerProfileId?: string;
  };
};

type NearbySearchRow = {
  id: string;
  customerProfileId: string;
  openkjVenueId: number;
  urlName: string;
  acceptingRequests: boolean;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string | null;
  phoneNumber: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number;
};

type NearbySearchOptions = {
  cacheTtlSeconds?: number;
  defaultRadiusMeters?: number;
  maxRadiusMeters?: number;
  defaultLimit?: number;
  maxLimit?: number;
};

export class PublicVenueSearchService {
  private readonly cacheTtlSeconds: number;
  private readonly defaultRadiusMeters: number;
  private readonly maxRadiusMeters: number;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: NearbySearchOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this.defaultRadiusMeters = options.defaultRadiusMeters ?? 25_000;
    this.maxRadiusMeters = options.maxRadiusMeters ?? 100_000;
    this.defaultLimit = options.defaultLimit ?? 25;
    this.maxLimit = options.maxLimit ?? 100;
  }

  async searchNearby(params: NearbyVenueSearchParams): Promise<NearbyVenueSearchResult> {
    const normalized = this.normalizeParams(params);
    const version = await this.getCacheVersion();
    const cacheKey = this.buildCacheKey(version, normalized);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as NearbyVenueSearchResult;
    }

    const rows = await this.fetchNearbyFromDatabase(normalized);
    const result: NearbyVenueSearchResult = {
      data: rows.map((row) => this.mapRowToDto(row)),
      query: normalized,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.cacheTtlSeconds);

    return result;
  }

  async invalidateCache(): Promise<void> {
    await this.redis.incr(this.getCacheVersionKey());
  }

  private normalizeParams(params: NearbyVenueSearchParams): NearbyVenueSearchResult['query'] {
    const radiusMeters = Math.min(
      Math.max(1, Math.round(params.radiusMeters ?? this.defaultRadiusMeters)),
      this.maxRadiusMeters,
    );
    const limit = Math.min(Math.max(1, Math.round(params.limit ?? this.defaultLimit)), this.maxLimit);

    return {
      latitude: params.latitude,
      longitude: params.longitude,
      radiusMeters,
      limit,
      acceptingRequests: params.acceptingRequests,
      customerProfileId: params.customerProfileId,
    };
  }

  private async fetchNearbyFromDatabase(
    params: NearbyVenueSearchResult['query'],
  ): Promise<NearbySearchRow[]> {
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${params.longitude}, ${params.latitude}), 4326)::geography`;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`v.location IS NOT NULL`,
      Prisma.sql`ST_DWithin(v.location, ${point}, ${params.radiusMeters})`,
    ];

    if (params.customerProfileId) {
      conditions.push(Prisma.sql`v.customer_profiles_id = ${params.customerProfileId}`);
    }

    if (params.acceptingRequests !== undefined) {
      conditions.push(Prisma.sql`v.accepting_requests = ${params.acceptingRequests}`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    return this.prisma.$queryRaw<NearbySearchRow[]>(Prisma.sql`
      SELECT
        v.venues_id AS "id",
        v.customer_profiles_id AS "customerProfileId",
        v.openkj_venue_id AS "openkjVenueId",
        v.url_name AS "urlName",
        v.accepting_requests AS "acceptingRequests",
        v.name AS "name",
        v.address AS "address",
        v.city AS "city",
        v.state AS "state",
        v.postal_code AS "postalCode",
        v.country AS "country",
        v.phone_number AS "phoneNumber",
        v.website AS "website",
        ST_Y(v.location::geometry) AS "latitude",
        ST_X(v.location::geometry) AS "longitude",
        ST_Distance(v.location, ${point}) AS "distanceMeters"
      FROM venues v
      ${whereClause}
      ORDER BY ST_Distance(v.location, ${point}) ASC
      LIMIT ${params.limit}
    `);
  }

  private mapRowToDto(row: NearbySearchRow): NearbyVenueDto {
    return {
      id: row.id,
      customerProfileId: row.customerProfileId,
      openkjVenueId: row.openkjVenueId,
      urlName: row.urlName,
      acceptingRequests: row.acceptingRequests,
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
      phoneNumber: row.phoneNumber,
      website: row.website,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMeters: row.distanceMeters,
    };
  }

  private buildCacheKey(version: number, params: NearbyVenueSearchResult['query']): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
    return `cache:public:venues:nearby:v${version}:${hash}`;
  }

  private getCacheVersionKey(): string {
    return 'cache:public:venues:nearby:version';
  }

  private async getCacheVersion(): Promise<number> {
    const raw = await this.redis.get(this.getCacheVersionKey());
    return raw ? Number(raw) : 0;
  }
}
