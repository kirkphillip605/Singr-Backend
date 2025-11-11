import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { ApiKeyService } from '../api-key-service';
import type { RedisClient } from '../../lib/redis';

describe('ApiKeyService', () => {
  const prismaRaw = {
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };

  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };

  const redisMock = redisRaw as unknown as RedisClient;

  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService(prismaMock, redisMock, { cacheTtlSeconds: 60 });
    vi.clearAllMocks();
  });

  it('returns cached API keys when available', async () => {
    redisRaw.get.mockResolvedValue(
      JSON.stringify([
        {
          id: 'key-1',
          customerProfileId: 'cust-1',
          description: 'cached',
          status: 'active',
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );

    const result = await service.listApiKeys('cust-1');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('key-1');
    expect(redisRaw.set).not.toHaveBeenCalled();
  });

  it('creates API keys and bumps cache version', async () => {
    const now = new Date();
    prismaRaw.apiKey.create.mockResolvedValue({
      id: 'key-123',
      customerProfileId: 'cust-1',
      description: 'demo',
      status: 'active',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.createApiKey('cust-1', { description: 'demo', createdByUserId: 'user-1' });

    expect(result.secret).toMatch(/^sk_/);
    expect(prismaRaw.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: 'demo' }),
      }),
    );
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:api-keys:cust-1:version');
  });

  it('revokes API key and invalidates cache', async () => {
    const now = new Date();
    prismaRaw.apiKey.findFirst.mockResolvedValueOnce({
      id: 'key-1',
      customerProfileId: 'cust-1',
      description: null,
      status: 'active',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    prismaRaw.apiKey.update.mockResolvedValue({
      id: 'key-1',
      customerProfileId: 'cust-1',
      description: null,
      status: 'revoked',
      lastUsedAt: null,
      revokedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const revoked = await service.revokeApiKey('cust-1', 'key-1');
    expect(revoked.status).toBe('revoked');
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:api-keys:cust-1:version');
  });
});
