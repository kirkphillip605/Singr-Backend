import type { Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

export type SingerProfileDto = {
  id: string;
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  preferences: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateSingerProfileInput = {
  nickname?: string | null;
  avatarUrl?: string | null;
  preferences?: Record<string, unknown> | null;
};

type SingerProfileServiceOptions = {
  cacheTtlSeconds?: number;
};

export class SingerProfileService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: SingerProfileServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 120;
  }

  async getProfile(singerProfileId: string): Promise<SingerProfileDto | null> {
    const version = await this.getCacheVersion(singerProfileId);
    const cacheKey = this.buildCacheKey(singerProfileId, version);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SingerProfileDto;
    }

    const profile = await this.prisma.singerProfile.findUnique({
      where: { id: singerProfileId },
      select: profileSelect,
    });

    if (!profile) {
      return null;
    }

    const dto = this.mapModelToDto(profile);
    await this.redis.set(cacheKey, JSON.stringify(dto), 'EX', this.cacheTtlSeconds);

    return dto;
  }

  async requireProfile(singerProfileId: string): Promise<SingerProfileDto> {
    const profile = await this.getProfile(singerProfileId);
    if (!profile) {
      throw createNotFoundError('Singer profile', { singerProfileId });
    }

    return profile;
  }

  async updateProfile(
    singerProfileId: string,
    input: UpdateSingerProfileInput,
  ): Promise<SingerProfileDto> {
    const existing = await this.prisma.singerProfile.findUnique({
      where: { id: singerProfileId },
      select: profileSelect,
    });

    if (!existing) {
      throw createNotFoundError('Singer profile', { singerProfileId });
    }

    const data: Prisma.SingerProfileUpdateInput = {};

    if (input.nickname !== undefined) {
      data.nickname = input.nickname?.trim() ?? null;
    }

    if (input.avatarUrl !== undefined) {
      data.avatarUrl = input.avatarUrl?.trim() ?? null;
    }

    if (input.preferences !== undefined) {
      data.preferences = (input.preferences ?? {}) as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.singerProfile.update({
      where: { id: singerProfileId },
      data,
      select: profileSelect,
    });

    await this.bumpCacheVersion(singerProfileId);

    return this.mapModelToDto(updated);
  }

  mapModelToDto(model: Prisma.SingerProfileGetPayload<{ select: typeof profileSelect }>): SingerProfileDto {
    return {
      id: model.id,
      userId: model.userId,
      nickname: model.nickname ?? null,
      avatarUrl: model.avatarUrl ?? null,
      preferences: (model.preferences as Record<string, unknown> | null) ?? null,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  async bumpCacheVersion(singerProfileId: string): Promise<void> {
    const key = this.getVersionKey(singerProfileId);
    await this.redis.incr(key);
  }

  private buildCacheKey(singerProfileId: string, version: number): string {
    return `cache:singer:profile:${singerProfileId}:v${version}`;
  }

  private getVersionKey(singerProfileId: string): string {
    return `cache:singer:profile:${singerProfileId}:version`;
  }

  private async getCacheVersion(singerProfileId: string): Promise<number> {
    const version = await this.redis.get(this.getVersionKey(singerProfileId));
    return version ? Number(version) : 0;
  }
}

const profileSelect = {
  id: true,
  userId: true,
  nickname: true,
  avatarUrl: true,
  preferences: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SingerProfileSelect;
