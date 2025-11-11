import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { SongdbIngestionService } from '../songdb-ingestion-service';
import type { RedisClient } from '../../lib/redis';
import type { SongIndexProducer } from '../../queues/producers';

describe('SongdbIngestionService', () => {
  const prismaRaw = {
    songDb: {
      createMany: vi.fn(),
    },
  };
  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redisMock = redisRaw as unknown as RedisClient;

  const songIndexProducerRaw = {
    enqueueRefresh: vi.fn(),
  };
  const songIndexProducer = songIndexProducerRaw as unknown as SongIndexProducer;

  let service: SongdbIngestionService;

  beforeEach(() => {
    service = new SongdbIngestionService(prismaMock, redisMock, songIndexProducer, {
      cacheTtlSeconds: 30,
    });
    vi.clearAllMocks();
  });

  it('ingests songs and queues index refresh', async () => {
    prismaRaw.songDb.createMany.mockResolvedValueOnce({ count: 2 });

    const result = await service.ingestSongs('cust-1', 101, [
      { artist: 'Artist', title: 'Song' },
      { artist: 'Another', title: 'Track' },
    ]);

    expect(result.inserted).toBe(2);
    expect(prismaRaw.songDb.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:songdb:cust-1:101:version');
    expect(songIndexProducerRaw.enqueueRefresh).toHaveBeenCalledWith({
      customerProfileId: 'cust-1',
      openkjSystemId: 101,
    });
  });

  it('throws when no songs provided', async () => {
    await expect(service.ingestSongs('cust-1', 1, [])).rejects.toThrow('At least one song');
  });
});
