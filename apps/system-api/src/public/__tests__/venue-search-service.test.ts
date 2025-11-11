import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '@prisma/client';

import { PublicVenueSearchService } from '../venue-search-service';
import type { RedisClient } from '../../lib/redis';

describe('PublicVenueSearchService', () => {
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

  let service: PublicVenueSearchService;
  let cacheKey: string | null;
  let cacheValue: string | null;

  beforeEach(() => {
    service = new PublicVenueSearchService(prismaMock, redisMock, { cacheTtlSeconds: 60 });
    cacheKey = null;
    cacheValue = null;
    vi.clearAllMocks();

    (Prisma as unknown as { sql: (...args: unknown[]) => unknown }).sql = vi.fn(() => ({}));
    (Prisma as unknown as { join: (...args: unknown[]) => unknown }).join = vi.fn(() => ({}));

    redisRaw.get.mockImplementation(async (key: string) => {
      if (key === 'cache:public:venues:nearby:version') {
        return '0';
      }

      return key === cacheKey ? cacheValue : null;
    });

    redisRaw.set.mockImplementation(async (key: string, value: string) => {
      cacheKey = key;
      cacheValue = value;
    });
  });

  it('fetches nearby venues and caches the response', async () => {
    prismaRaw.$queryRaw.mockResolvedValue([
      {
        id: 'venue-1',
        customerProfileId: 'cust-1',
        openkjVenueId: 101,
        urlName: 'karaoke-hub',
        acceptingRequests: true,
        name: 'Karaoke Hub',
        address: '123 Main',
        city: 'Austin',
        state: 'TX',
        postalCode: '73301',
        country: 'US',
        phoneNumber: null,
        website: null,
        latitude: 30,
        longitude: -97,
        distanceMeters: 500,
      },
    ]);

    const result = await service.searchNearby({ latitude: 30, longitude: -97 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('venue-1');
    expect(redisRaw.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60);
  });

  it('returns cached result when available', async () => {
    prismaRaw.$queryRaw.mockResolvedValue([
      {
        id: 'venue-1',
        customerProfileId: 'cust-1',
        openkjVenueId: 101,
        urlName: 'karaoke-hub',
        acceptingRequests: true,
        name: 'Karaoke Hub',
        address: '123 Main',
        city: 'Austin',
        state: 'TX',
        postalCode: '73301',
        country: 'US',
        phoneNumber: null,
        website: null,
        latitude: 30,
        longitude: -97,
        distanceMeters: 500,
      },
    ]);

    const first = await service.searchNearby({ latitude: 30, longitude: -97 });
    expect(first.data).toHaveLength(1);

    prismaRaw.$queryRaw.mockClear();

    const second = await service.searchNearby({ latitude: 30, longitude: -97 });
    expect(second.data).toHaveLength(1);
    expect(prismaRaw.$queryRaw).not.toHaveBeenCalled();
  });
});
