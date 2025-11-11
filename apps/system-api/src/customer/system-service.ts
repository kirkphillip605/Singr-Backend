import type { Prisma, PrismaClient, System as SystemModel } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

export type SystemDto = {
  id: string;
  customerProfileId: string;
  openkjSystemId: number;
  name: string;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateSystemInput = {
  openkjSystemId: number;
  name: string;
  configuration?: Record<string, unknown>;
};

export type UpdateSystemInput = {
  openkjSystemId?: number;
  name?: string;
  configuration?: Record<string, unknown>;
};

type SystemServiceOptions = {
  cacheTtlSeconds?: number;
};

export class SystemService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: SystemServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
  }

  async listSystems(customerProfileId: string): Promise<SystemDto[]> {
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildListCacheKey(customerProfileId, version);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as SystemDto[];
    }

    const systems = await this.prisma.system.findMany({
      where: { customerProfileId },
      orderBy: { name: 'asc' },
    });

    const data = systems.map((system) => this.mapModelToDto(system));

    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);

    return data;
  }

  async getSystem(customerProfileId: string, systemId: string): Promise<SystemDto | null> {
    const system = await this.prisma.system.findFirst({
      where: { id: systemId, customerProfileId },
    });

    if (!system) {
      return null;
    }

    return this.mapModelToDto(system);
  }

  async createSystem(customerProfileId: string, input: CreateSystemInput): Promise<SystemDto> {
    try {
      const created = await this.prisma.system.create({
        data: {
          customerProfileId,
          openkjSystemId: input.openkjSystemId,
          name: input.name,
          configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
        },
      });

      await this.bumpCacheVersion(customerProfileId);
      return this.mapModelToDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createValidationError(
          'A system with this OpenKJ identifier already exists for this customer.',
          undefined,
          error,
        );
      }

      throw error;
    }
  }

  async updateSystem(
    customerProfileId: string,
    systemId: string,
    input: UpdateSystemInput,
  ): Promise<SystemDto> {
    const existing = await this.prisma.system.findFirst({
      where: { id: systemId, customerProfileId },
    });

    if (!existing) {
      throw createNotFoundError('System', { systemId });
    }

    const data: Prisma.SystemUpdateInput = {};

    if (input.openkjSystemId !== undefined) {
      data.openkjSystemId = input.openkjSystemId;
    }

    if (input.name !== undefined) {
      data.name = input.name;
    }

    if (input.configuration !== undefined) {
      data.configuration = input.configuration as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      return this.mapModelToDto(existing);
    }

    try {
      const updated = await this.prisma.system.update({
        where: { id: existing.id },
        data,
      });

      await this.bumpCacheVersion(customerProfileId);
      return this.mapModelToDto(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createValidationError(
          'A system with this OpenKJ identifier already exists for this customer.',
          undefined,
          error,
        );
      }

      throw error;
    }
  }

  async deleteSystem(customerProfileId: string, systemId: string): Promise<void> {
    const result = await this.prisma.system.deleteMany({
      where: { id: systemId, customerProfileId },
    });

    if (result.count === 0) {
      throw createNotFoundError('System', { systemId });
    }

    await this.bumpCacheVersion(customerProfileId);
  }

  private mapModelToDto(system: SystemModel): SystemDto {
    return {
      id: system.id,
      customerProfileId: system.customerProfileId,
      openkjSystemId: system.openkjSystemId,
      name: system.name,
      configuration: normalizeConfiguration(system.configuration),
      createdAt: system.createdAt.toISOString(),
      updatedAt: system.updatedAt.toISOString(),
    };
  }

  private buildListCacheKey(customerProfileId: string, version: number): string {
    return `cache:systems:${customerProfileId}:v${version}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:systems:${customerProfileId}:version`;
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

function normalizeConfiguration(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function isUniqueViolation(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === 'P2002' || code === '23505';
}
