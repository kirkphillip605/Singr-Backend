import { createHash } from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

export type VenueDto = {
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
  createdAt: string;
  updatedAt: string;
};

export type VenueListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  city?: string;
  state?: string;
  acceptingRequests?: boolean;
};

export type VenueListResult = {
  data: VenueDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type CreateVenueInput = {
  openkjVenueId: number;
  urlName: string;
  acceptingRequests?: boolean;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  phoneNumber?: string | null;
  website?: string | null;
  latitude: number;
  longitude: number;
};

export type UpdateVenueInput = Partial<
  Omit<CreateVenueInput, 'latitude' | 'longitude'> & {
    latitude: number;
    longitude: number;
  }
>;

type VenueRow = {
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
  createdAt: Date;
  updatedAt: Date;
};

type NormalizedVenueListParams = {
  page: number;
  pageSize: number;
  search?: string;
  city?: string;
  state?: string;
  acceptingRequests?: boolean;
};

type VenueServiceOptions = {
  cacheTtlSeconds?: number;
};

export class VenueService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: VenueServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
  }

  async listVenues(customerProfileId: string, params: VenueListParams): Promise<VenueListResult> {
    const normalized = this.normalizeListParams(params);
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildListCacheKey(customerProfileId, version, normalized);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as VenueListResult;
    }

    const { items, total } = await this.fetchVenuesFromDatabase(customerProfileId, normalized);
    const result: VenueListResult = {
      data: items.map((item) => this.mapRowToDto(item)),
      pagination: {
        page: normalized.page,
        pageSize: normalized.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / normalized.pageSize),
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.cacheTtlSeconds);

    return result;
  }

  async getVenue(customerProfileId: string, venueId: string): Promise<VenueDto | null> {
    const rows = await this.prisma.$queryRaw<VenueRow[]>(Prisma.sql`
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
        v.created_at AS "createdAt",
        v.updated_at AS "updatedAt"
      FROM venues v
      WHERE v.venues_id = ${venueId} AND v.customer_profiles_id = ${customerProfileId}
      LIMIT 1
    `);

    if (rows.length === 0) {
      return null;
    }

    return this.mapRowToDto(rows[0]);
  }

  async createVenue(customerProfileId: string, input: CreateVenueInput): Promise<VenueDto> {
    const locationExpression = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography`;

    try {
      const rows = await this.prisma.$queryRaw<VenueRow[]>(Prisma.sql`
        INSERT INTO venues (
          customer_profiles_id,
          openkj_venue_id,
          url_name,
          accepting_requests,
          name,
          address,
          city,
          state,
          postal_code,
          country,
          phone_number,
          website,
          location
        )
        VALUES (
          ${customerProfileId},
          ${input.openkjVenueId},
          ${input.urlName},
          ${input.acceptingRequests ?? true},
          ${input.name},
          ${input.address},
          ${input.city},
          ${input.state},
          ${input.postalCode},
          ${input.country ?? null},
          ${input.phoneNumber ?? null},
          ${input.website ?? null},
          ${locationExpression}
        )
        RETURNING
          venues_id AS "id",
          customer_profiles_id AS "customerProfileId",
          openkj_venue_id AS "openkjVenueId",
          url_name AS "urlName",
          accepting_requests AS "acceptingRequests",
          name AS "name",
          address AS "address",
          city AS "city",
          state AS "state",
          postal_code AS "postalCode",
          country AS "country",
          phone_number AS "phoneNumber",
          website AS "website",
          ST_Y(location::geometry) AS "latitude",
          ST_X(location::geometry) AS "longitude",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `);

      const created = rows[0];
      if (!created) {
        throw createValidationError('Failed to create venue.');
      }

      await this.bumpCacheVersion(customerProfileId);
      return this.mapRowToDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createValidationError(
          'A venue with this URL name or OpenKJ identifier already exists.',
          undefined,
          error,
        );
      }

      throw error;
    }
  }

  async updateVenue(
    customerProfileId: string,
    venueId: string,
    input: UpdateVenueInput,
  ): Promise<VenueDto> {
    const assignments: Prisma.Sql[] = [];

    if (input.openkjVenueId !== undefined) {
      assignments.push(Prisma.sql`openkj_venue_id = ${input.openkjVenueId}`);
    }
    if (input.urlName !== undefined) {
      assignments.push(Prisma.sql`url_name = ${input.urlName}`);
    }
    if (input.acceptingRequests !== undefined) {
      assignments.push(Prisma.sql`accepting_requests = ${input.acceptingRequests}`);
    }
    if (input.name !== undefined) {
      assignments.push(Prisma.sql`name = ${input.name}`);
    }
    if (input.address !== undefined) {
      assignments.push(Prisma.sql`address = ${input.address}`);
    }
    if (input.city !== undefined) {
      assignments.push(Prisma.sql`city = ${input.city}`);
    }
    if (input.state !== undefined) {
      assignments.push(Prisma.sql`state = ${input.state}`);
    }
    if (input.postalCode !== undefined) {
      assignments.push(Prisma.sql`postal_code = ${input.postalCode}`);
    }
    if (input.country !== undefined) {
      assignments.push(Prisma.sql`country = ${input.country}`);
    }
    if (input.phoneNumber !== undefined) {
      assignments.push(Prisma.sql`phone_number = ${input.phoneNumber}`);
    }
    if (input.website !== undefined) {
      assignments.push(Prisma.sql`website = ${input.website}`);
    }
    if (input.latitude !== undefined && input.longitude !== undefined) {
      const locationExpression = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography`;
      assignments.push(Prisma.sql`location = ${locationExpression}`);
    }

    if (assignments.length === 0) {
      const existing = await this.getVenue(customerProfileId, venueId);
      if (!existing) {
        throw createNotFoundError('Venue', { venueId });
      }

      return existing;
    }

    assignments.push(Prisma.sql`updated_at = now()`);

    try {
      const rows = await this.prisma.$queryRaw<VenueRow[]>(Prisma.sql`
        UPDATE venues
        SET ${Prisma.join(assignments, ', ')}
        WHERE venues_id = ${venueId} AND customer_profiles_id = ${customerProfileId}
        RETURNING
          venues_id AS "id",
          customer_profiles_id AS "customerProfileId",
          openkj_venue_id AS "openkjVenueId",
          url_name AS "urlName",
          accepting_requests AS "acceptingRequests",
          name AS "name",
          address AS "address",
          city AS "city",
          state AS "state",
          postal_code AS "postalCode",
          country AS "country",
          phone_number AS "phoneNumber",
          website AS "website",
          ST_Y(location::geometry) AS "latitude",
          ST_X(location::geometry) AS "longitude",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `);

      if (rows.length === 0) {
        throw createNotFoundError('Venue', { venueId });
      }

      await this.bumpCacheVersion(customerProfileId);
      return this.mapRowToDto(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createValidationError(
          'A venue with this URL name or OpenKJ identifier already exists.',
          undefined,
          error,
        );
      }

      throw error;
    }
  }

  async deleteVenue(customerProfileId: string, venueId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      DELETE FROM venues
      WHERE venues_id = ${venueId} AND customer_profiles_id = ${customerProfileId}
      RETURNING venues_id AS id
    `);

    if (rows.length === 0) {
      throw createNotFoundError('Venue', { venueId });
    }

    await this.bumpCacheVersion(customerProfileId);
  }

  private mapRowToDto(row: VenueRow): VenueDto {
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizeListParams(params: VenueListParams): NormalizedVenueListParams {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(Math.max(1, params.pageSize ?? 20), 100);
    const search = params.search?.trim();
    const city = params.city?.trim();
    const state = params.state?.trim();

    return {
      page,
      pageSize,
      search: search && search.length > 0 ? search : undefined,
      city: city && city.length > 0 ? city : undefined,
      state: state && state.length > 0 ? state : undefined,
      acceptingRequests: params.acceptingRequests,
    };
  }

  private async fetchVenuesFromDatabase(
    customerProfileId: string,
    params: NormalizedVenueListParams,
  ): Promise<{ items: VenueRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [Prisma.sql`v.customer_profiles_id = ${customerProfileId}`];

    if (params.city) {
      conditions.push(Prisma.sql`LOWER(v.city) = LOWER(${params.city})`);
    }

    if (params.state) {
      conditions.push(Prisma.sql`LOWER(v.state) = LOWER(${params.state})`);
    }

    if (params.acceptingRequests !== undefined) {
      conditions.push(Prisma.sql`v.accepting_requests = ${params.acceptingRequests}`);
    }

    if (params.search) {
      const like = `%${params.search}%`;
      conditions.push(
        Prisma.sql`(v.name ILIKE ${like} OR v.city ILIKE ${like} OR v.address ILIKE ${like})`,
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const offset = (params.page - 1) * params.pageSize;

    const items = await this.prisma.$queryRaw<VenueRow[]>(Prisma.sql`
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
        v.created_at AS "createdAt",
        v.updated_at AS "updatedAt"
      FROM venues v
      ${whereClause}
      ORDER BY v.name ASC
      LIMIT ${params.pageSize}
      OFFSET ${offset}
    `);

    const countRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM venues v
      ${whereClause}
    `);

    const total = countRows.length > 0 ? Number(countRows[0].count) : 0;

    return { items, total };
  }

  private buildListCacheKey(
    customerProfileId: string,
    version: number,
    params: NormalizedVenueListParams,
  ): string {
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
    return `cache:venues:${customerProfileId}:v${version}:${hash}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:venues:${customerProfileId}:version`;
  }

  private async getCacheVersion(customerProfileId: string): Promise<number> {
    const key = this.getCacheVersionKey(customerProfileId);
    const value = await this.redis.get(key);
    return value ? Number(value) : 0;
  }

  private async bumpCacheVersion(customerProfileId: string): Promise<void> {
    const key = this.getCacheVersionKey(customerProfileId);
    await this.redis.incr(key);
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === 'P2002' || code === '23505';
}
