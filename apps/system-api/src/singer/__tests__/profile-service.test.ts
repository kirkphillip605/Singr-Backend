import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { RedisClient } from '../../lib/redis';
import { SingerProfileService } from '../profile-service';

describe('SingerProfileService', () => {
  const prismaRaw = {
    singerProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redis = redisRaw as unknown as RedisClient;

  let service: SingerProfileService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SingerProfileService(prisma, redis, { cacheTtlSeconds: 60 });
  });

  it('fetches profile and caches result', async () => {
    redisRaw.get.mockResolvedValueOnce(null);
    prismaRaw.singerProfile.findUnique.mockResolvedValueOnce({
      id: 'sp_1',
      userId: 'user_1',
      nickname: 'DJ',
      avatarUrl: null,
      preferences: {},
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    });

    const profile = await service.getProfile('sp_1');

    expect(profile?.id).toBe('sp_1');
    expect(redisRaw.set).toHaveBeenCalledWith(
      expect.stringContaining('cache:singer:profile:sp_1'),
      expect.any(String),
      'EX',
      60,
    );
  });

  it('returns cached profile if available', async () => {
    redisRaw.get.mockResolvedValueOnce('1');
    redisRaw.get.mockResolvedValueOnce(
      JSON.stringify({
        id: 'sp_2',
        userId: 'user_2',
        nickname: 'Cached',
        avatarUrl: null,
        preferences: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      }),
    );

    const profile = await service.getProfile('sp_2');

    expect(profile?.nickname).toBe('Cached');
    expect(prismaRaw.singerProfile.findUnique).not.toHaveBeenCalled();
  });

  it('updates profile and bumps cache version', async () => {
    prismaRaw.singerProfile.findUnique.mockResolvedValueOnce({
      id: 'sp_3',
      userId: 'user_3',
      nickname: 'Before',
      avatarUrl: null,
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaRaw.singerProfile.update.mockResolvedValueOnce({
      id: 'sp_3',
      userId: 'user_3',
      nickname: 'After',
      avatarUrl: null,
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updated = await service.updateProfile('sp_3', { nickname: 'After' });

    expect(updated.nickname).toBe('After');
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:singer:profile:sp_3:version');
  });
});
