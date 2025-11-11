import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '@prisma/client';

import { PublicSongSearchService } from '../song-search-service';
import type { RedisClient } from '../../lib/redis';

describe('PublicSongSearchService', () => {
  const prismaRaw = {
    $queryRaw: vi.fn(),
  };
  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redisMock = redisRaw as unknown as RedisClient;

  let service: PublicSongSearchService;
  let cacheKey: string | null;
  let cacheValue: string | null;

  beforeEach(() => {
    service = new PublicSongSearchService(prismaMock, redisMock, { cacheTtlSeconds: 120 });
    cacheKey = null;
    cacheValue = null;
    vi.clearAllMocks();

    (Prisma as unknown as { sql: (...args: unknown[]) => unknown }).sql = vi.fn(() => ({}));
    (Prisma as unknown as { join: (...args: unknown[]) => unknown }).join = vi.fn(() => ({}));

    redisRaw.get.mockImplementation(async (key: string) => {
      if (key === 'cache:public:songs:search:version') {
        return '0';
      }

      return key === cacheKey ? cacheValue : null;
    });

    redisRaw.set.mockImplementation(async (key: string, value: string) => {
      cacheKey = key;
      cacheValue = value;
    });
  });

  it('queries songs and caches the result', async () => {
    prismaRaw.$queryRaw
      .mockResolvedValueOnce([
        {
          id: '1',
          customerProfileId: 'cust-1',
          openkjSystemId: 42,
          artist: 'Artist',
          title: 'Title',
          combined: 'Artist - Title',
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

    const result = await service.searchSongs({ query: 'Artist Title' });
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(redisRaw.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 120);
  });

  it('returns cached songs when query repeats', async () => {
    prismaRaw.$queryRaw
      .mockResolvedValueOnce([
        {
          id: '1',
          customerProfileId: 'cust-1',
          openkjSystemId: 42,
          artist: 'Artist',
          title: 'Title',
          combined: 'Artist - Title',
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

    const first = await service.searchSongs({ query: 'Artist Title', limit: 5 });
    expect(first.data).toHaveLength(1);

    prismaRaw.$queryRaw.mockClear();

    const second = await service.searchSongs({ query: 'Artist Title', limit: 5 });
    expect(second.data).toHaveLength(1);
    expect(prismaRaw.$queryRaw).not.toHaveBeenCalled();
  });
});
