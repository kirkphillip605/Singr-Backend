import { createHash } from 'crypto';

import type { Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { AppLogger } from '../lib/logger';
import type { RedisClient } from '../lib/redis';
import { enforceSlidingWindowLimit } from '../rate-limit/redis-window';
import type { SingerRequestNotificationProducer } from '../queues/producers';
import type { SingerHistoryService } from './history-service';

export type CreateSingerRequestInput = {
  venueId: string;
  artist: string;
  title: string;
  keyChange?: number;
  notes?: string | null;
  submittedByUserId: string;
};

export type SingerRequestDto = {
  id: string;
  venueId: string;
  singerProfileId: string;
  artist: string;
  title: string;
  keyChange: number;
  notes: string | null;
  requestedAt: string;
};

type SingerRequestServiceOptions = {
  perSingerLimit?: number;
  perSingerWindowMs?: number;
  perVenueLimit?: number;
  perVenueWindowMs?: number;
};

export class SingerRequestService {
  private readonly perSingerLimit: number;
  private readonly perSingerWindowMs: number;
  private readonly perVenueLimit: number;
  private readonly perVenueWindowMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    private readonly historyService: SingerHistoryService,
    private readonly queue: SingerRequestNotificationProducer,
    private readonly logger: AppLogger,
    options: SingerRequestServiceOptions = {},
  ) {
    this.perSingerLimit = options.perSingerLimit ?? 10;
    this.perSingerWindowMs = options.perSingerWindowMs ?? 300_000;
    this.perVenueLimit = options.perVenueLimit ?? 30;
    this.perVenueWindowMs = options.perVenueWindowMs ?? 300_000;
  }

  async createRequest(
    singerProfileId: string,
    input: CreateSingerRequestInput,
  ): Promise<SingerRequestDto> {
    const artist = input.artist.trim();
    const title = input.title.trim();
    if (!artist) {
      throw createValidationError('Artist is required.');
    }

    if (!title) {
      throw createValidationError('Title is required.');
    }

    const keyChange = input.keyChange ?? 0;

    await Promise.all([
      this.enforceSingerRateLimit(singerProfileId),
      this.enforceVenueRateLimit(input.venueId),
    ]);

    const requestedAt = new Date();

    const { request, venue } = await this.prisma.$transaction(async (tx) => {
      const singerProfile = await tx.singerProfile.findUnique({
        where: { id: singerProfileId },
        select: { id: true, userId: true },
      });

      if (!singerProfile) {
        throw createNotFoundError('Singer profile', { singerProfileId });
      }

      if (singerProfile.userId !== input.submittedByUserId) {
        throw createValidationError('Singer profile does not belong to the authenticated user.');
      }

      const venueRecord = await tx.venue.findUnique({
        where: { id: input.venueId },
        select: {
          id: true,
          customerProfileId: true,
          acceptingRequests: true,
        },
      });

      if (!venueRecord) {
        throw createNotFoundError('Venue', { venueId: input.venueId });
      }

      if (!venueRecord.acceptingRequests) {
        throw createValidationError('This venue is not currently accepting requests.', {
          venueId: input.venueId,
        });
      }

      const notes = input.notes?.trim() ?? null;
      const requestRecord = await tx.request.create({
        data: {
          venueId: input.venueId,
          singerProfileId,
          submittedByUserId: input.submittedByUserId,
          artist,
          title,
          keyChange,
          notes,
          requestedAt,
        },
        select: requestSelect,
      });

      const songFingerprint = this.computeSongFingerprint({
        singerProfileId,
        venueId: input.venueId,
        artist,
        title,
        keyChange,
      });

      await this.historyService.createHistoryEntry(tx, {
        singerProfileId,
        venueId: input.venueId,
        artist,
        title,
        keyChange,
        requestedAt,
        songFingerprint,
      });

      return { request: requestRecord, venue: venueRecord };
    });

    await this.historyService.bumpCacheVersion(singerProfileId);

    await this.queue.enqueueRequestNotification({
      requestId: request.id.toString(),
      singerProfileId,
      userId: input.submittedByUserId,
      venueId: request.venueId,
      customerProfileId: venue.customerProfileId,
      artist: request.artist,
      title: request.title,
      keyChange: request.keyChange,
      notes: request.notes,
      requestedAt: request.requestedAt.toISOString(),
    });

    this.logger.info(
      {
        singerProfileId,
        venueId: request.venueId,
        requestId: request.id,
      },
      'Singer request created',
    );

    return this.mapRequestToDto(request);
  }

  private async enforceSingerRateLimit(singerProfileId: string): Promise<void> {
    await enforceSlidingWindowLimit(this.redis, `singer:requests:${singerProfileId}`, {
      limit: this.perSingerLimit,
      windowMs: this.perSingerWindowMs,
    });
  }

  private async enforceVenueRateLimit(venueId: string): Promise<void> {
    await enforceSlidingWindowLimit(this.redis, `venue:requests:${venueId}`, {
      limit: this.perVenueLimit,
      windowMs: this.perVenueWindowMs,
    });
  }

  private computeSongFingerprint(input: {
    singerProfileId: string;
    venueId: string;
    artist: string;
    title: string;
    keyChange: number;
  }): string {
    const hash = createHash('sha256');
    hash.update(input.singerProfileId);
    hash.update('|');
    hash.update(input.venueId);
    hash.update('|');
    hash.update(input.artist.toLowerCase());
    hash.update('|');
    hash.update(input.title.toLowerCase());
    hash.update('|');
    hash.update(String(input.keyChange));
    return hash.digest('hex');
  }

  private mapRequestToDto(
    model: Prisma.RequestGetPayload<{ select: typeof requestSelect }>,
  ): SingerRequestDto {
    return {
      id: model.id.toString(),
      venueId: model.venueId,
      singerProfileId: model.singerProfileId!,
      artist: model.artist,
      title: model.title,
      keyChange: model.keyChange,
      notes: model.notes ?? null,
      requestedAt: model.requestedAt.toISOString(),
    };
  }
}

const requestSelect = {
  id: true,
  venueId: true,
  singerProfileId: true,
  artist: true,
  title: true,
  keyChange: true,
  notes: true,
  requestedAt: true,
} satisfies Prisma.RequestSelect;
