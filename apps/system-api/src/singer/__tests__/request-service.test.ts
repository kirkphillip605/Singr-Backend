import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { RedisClient } from '../../lib/redis';
import type { SingerHistoryService } from '../history-service';
import { SingerRequestService } from '../request-service';
import type { SingerRequestNotificationProducer } from '../../queues/producers';
import type { AppLogger } from '../../lib/logger';

vi.mock('../../rate-limit/redis-window', () => ({
  enforceSlidingWindowLimit: vi.fn().mockResolvedValue({ limit: 10, remaining: 9, reset: 0 }),
}));

const { enforceSlidingWindowLimit } = await import('../../rate-limit/redis-window');

describe('SingerRequestService', () => {
  const prismaRaw = {
    $transaction: vi.fn(),
    singerProfile: {
      findUnique: vi.fn(),
    },
    venue: {
      findUnique: vi.fn(),
    },
    request: {
      create: vi.fn(),
    },
  };
  const prisma = prismaRaw as unknown as PrismaClient;

  const redisRaw = {} as unknown as RedisClient;

  const historyService: Pick<SingerHistoryService, 'createHistoryEntry' | 'bumpCacheVersion'> = {
    createHistoryEntry: vi.fn(),
    bumpCacheVersion: vi.fn(),
  };
  const queue: Pick<SingerRequestNotificationProducer, 'enqueueRequestNotification'> = {
    enqueueRequestNotification: vi.fn(),
  };
  const logger: Pick<AppLogger, 'info'> = {
    info: vi.fn(),
  };

  let service: SingerRequestService;

  beforeEach(() => {
    vi.clearAllMocks();

    prismaRaw.$transaction.mockImplementation(async (fn: (tx: typeof prismaRaw) => Promise<unknown>) => {
      return fn(prismaRaw);
    });

    service = new SingerRequestService(
      prisma,
      redisRaw,
      historyService as SingerHistoryService,
      queue as SingerRequestNotificationProducer,
      logger as AppLogger,
      { perSingerLimit: 5, perSingerWindowMs: 60_000, perVenueLimit: 20, perVenueWindowMs: 60_000 },
    );
  });

  it('creates request, records history, and enqueues notification', async () => {
    prismaRaw.singerProfile.findUnique.mockResolvedValueOnce({ id: 'sp_1', userId: 'user_1' });
    prismaRaw.venue.findUnique.mockResolvedValueOnce({
      id: 'venue_1',
      customerProfileId: 'cust_1',
      acceptingRequests: true,
    });
    prismaRaw.request.create.mockResolvedValueOnce({
      id: BigInt(42),
      venueId: 'venue_1',
      singerProfileId: 'sp_1',
      artist: 'Artist',
      title: 'Song',
      keyChange: 0,
      notes: null,
      requestedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const result = await service.createRequest('sp_1', {
      venueId: 'venue_1',
      artist: 'Artist',
      title: 'Song',
      submittedByUserId: 'user_1',
    });

    expect(result.id).toBe('42');
    expect(enforceSlidingWindowLimit).toHaveBeenCalledWith(expect.anything(), 'singer:requests:sp_1', {
      limit: 5,
      windowMs: 60_000,
    });
    expect(historyService.createHistoryEntry).toHaveBeenCalled();
    expect(historyService.bumpCacheVersion).toHaveBeenCalledWith('sp_1');
    expect(queue.enqueueRequestNotification).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: '42', venueId: 'venue_1' }),
    );
  });

  it('rejects when venue is not accepting requests', async () => {
    prismaRaw.singerProfile.findUnique.mockResolvedValueOnce({ id: 'sp_1', userId: 'user_1' });
    prismaRaw.venue.findUnique.mockResolvedValueOnce({
      id: 'venue_1',
      customerProfileId: 'cust_1',
      acceptingRequests: false,
    });

    await expect(
      service.createRequest('sp_1', {
        venueId: 'venue_1',
        artist: 'Artist',
        title: 'Song',
        submittedByUserId: 'user_1',
      }),
    ).rejects.toMatchObject({ problem: { status: 422 } });
  });

  it('rejects when profile does not match user', async () => {
    prismaRaw.singerProfile.findUnique.mockResolvedValueOnce({ id: 'sp_1', userId: 'user_2' });

    await expect(
      service.createRequest('sp_1', {
        venueId: 'venue_1',
        artist: 'Artist',
        title: 'Song',
        submittedByUserId: 'user_1',
      }),
    ).rejects.toMatchObject({ problem: { status: 422 } });
  });
});
