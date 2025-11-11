import { randomBytes, createHash } from 'crypto';

import type { ApiKeyStatus, Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

export type ApiKeyDto = {
  id: string;
  customerProfileId: string;
  description: string | null;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateApiKeyInput = {
  description?: string | null;
  metadata?: Record<string, unknown>;
  customerId?: string | null;
  createdByUserId?: string | null;
};

export type CreateApiKeyResult = {
  apiKey: ApiKeyDto;
  secret: string;
};

export type UpdateApiKeyInput = {
  description?: string | null;
  metadata?: Record<string, unknown>;
};

type ApiKeyServiceOptions = {
  cacheTtlSeconds?: number;
};

export class ApiKeyService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: ApiKeyServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
  }

  async listApiKeys(customerProfileId: string): Promise<ApiKeyDto[]> {
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildListCacheKey(customerProfileId, version);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as ApiKeyDto[];
    }

    const apiKeys = await this.prisma.apiKey.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: 'desc' },
      select: apiKeySelect,
    });

    const data = apiKeys.map((key) => this.mapModelToDto(key));
    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);

    return data;
  }

  async createApiKey(customerProfileId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const secret = this.generateSecret();
    const apiKeyHash = createHash('sha256').update(secret).digest('hex');

    const created = await this.prisma.apiKey.create({
      data: {
        customerProfileId,
        customerId: input.customerId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        description: input.description?.trim() ?? null,
        apiKeyHash,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: apiKeySelect,
    });

    await this.bumpCacheVersion(customerProfileId);

    return {
      apiKey: this.mapModelToDto(created),
      secret,
    };
  }

  async updateApiKey(customerProfileId: string, apiKeyId: string, input: UpdateApiKeyInput): Promise<ApiKeyDto> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, customerProfileId },
      select: apiKeySelect,
    });

    if (!existing) {
      throw createNotFoundError('API key', { apiKeyId });
    }

    const data: Prisma.ApiKeyUpdateInput = {};

    if (input.description !== undefined) {
      data.description = input.description?.trim() ?? null;
    }

    if (input.metadata !== undefined) {
      data.metadata = input.metadata as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      return this.mapModelToDto(existing);
    }

    const updated = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data,
      select: apiKeySelect,
    });

    await this.bumpCacheVersion(customerProfileId);

    return this.mapModelToDto(updated);
  }

  async revokeApiKey(customerProfileId: string, apiKeyId: string): Promise<ApiKeyDto> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, customerProfileId },
      select: apiKeySelect,
    });

    if (!existing) {
      throw createNotFoundError('API key', { apiKeyId });
    }

    if (existing.status === 'revoked') {
      return this.mapModelToDto(existing);
    }

    const revoked = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
      },
      select: apiKeySelect,
    });

    await this.bumpCacheVersion(customerProfileId);

    return this.mapModelToDto(revoked);
  }

  private mapModelToDto(model: Prisma.ApiKeyGetPayload<{ select: typeof apiKeySelect }>): ApiKeyDto {
    return {
      id: model.id,
      customerProfileId: model.customerProfileId,
      description: model.description ?? null,
      status: model.status,
      lastUsedAt: model.lastUsedAt ? model.lastUsedAt.toISOString() : null,
      revokedAt: model.revokedAt ? model.revokedAt.toISOString() : null,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private buildListCacheKey(customerProfileId: string, version: number): string {
    return `cache:api-keys:${customerProfileId}:v${version}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:api-keys:${customerProfileId}:version`;
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

  private generateSecret(): string {
    const raw = randomBytes(32).toString('base64url');
    return `sk_${raw}`;
  }
}

const apiKeySelect = {
  id: true,
  customerProfileId: true,
  description: true,
  status: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ApiKeySelect;
