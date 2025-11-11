import { createValidationError } from '../http/problem';
import type { ApiKeyService, ApiKeyValidationResult } from '../customer/api-key-service';
import type { PublicSongSearchService } from '../public/song-search-service';
import type { PublicVenueSearchService } from '../public/venue-search-service';

export type OpenKjCommandRequest = {
  apiKey: string;
  command: string;
  payload?: unknown;
};

export type OpenKjCommandResponse =
  | { status: 'ok'; command: string; result: unknown }
  | { status: 'error'; command: string; error: { code: string; message: string } };

type ExecuteContext = {
  apiKey: ApiKeyValidationResult;
};

type CommandHandler = (
  payload: unknown,
  context: ExecuteContext,
) => Promise<OpenKjCommandResponse>;

export class OpenKjCommandService {
  private readonly handlers: Record<string, CommandHandler>;

  constructor(
    private readonly dependencies: {
      apiKeyService: ApiKeyService;
      venueSearchService: PublicVenueSearchService;
      songSearchService: PublicSongSearchService;
    },
  ) {
    this.handlers = {
      ping: this.handlePing,
      'venues.nearby': this.handleVenuesNearby,
      'songs.search': this.handleSongsSearch,
    };
  }

  async execute(request: OpenKjCommandRequest): Promise<OpenKjCommandResponse> {
    const apiKey = await this.dependencies.apiKeyService.validateSecret(request.apiKey);
    if (!apiKey) {
      return {
        status: 'error',
        command: request.command,
        error: { code: 'invalid_api_key', message: 'Invalid API key provided.' },
      };
    }

    const handler = this.handlers[request.command];
    if (!handler) {
      return {
        status: 'error',
        command: request.command,
        error: { code: 'unsupported_command', message: 'Unsupported OpenKJ command.' },
      };
    }

    return handler.call(this, request.payload, { apiKey });
  }

  private async handlePing(_: unknown, context: ExecuteContext): Promise<OpenKjCommandResponse> {
    return {
      status: 'ok',
      command: 'ping',
      result: {
        message: 'pong',
        customerProfileId: context.apiKey.customerProfileId,
      },
    };
  }

  private async handleVenuesNearby(
    payload: unknown,
    context: ExecuteContext,
  ): Promise<OpenKjCommandResponse> {
    const schema = this.parsePayload(payload, {
      latitude: 'number',
      longitude: 'number',
      radiusMeters: ['number', undefined],
      limit: ['number', undefined],
      acceptingRequests: ['boolean', undefined],
    });

    const result = await this.dependencies.venueSearchService.searchNearby({
      latitude: schema.latitude,
      longitude: schema.longitude,
      radiusMeters: schema.radiusMeters,
      limit: schema.limit,
      acceptingRequests: schema.acceptingRequests,
      customerProfileId: context.apiKey.customerProfileId,
    });

    return {
      status: 'ok',
      command: 'venues.nearby',
      result,
    };
  }

  private async handleSongsSearch(
    payload: unknown,
    context: ExecuteContext,
  ): Promise<OpenKjCommandResponse> {
    const schema = this.parsePayload(payload, {
      query: 'string',
      limit: ['number', undefined],
      offset: ['number', undefined],
      openkjSystemId: ['number', undefined],
    });

    if (!schema.query || schema.query.trim().length === 0) {
      throw createValidationError('Search query must be provided.');
    }

    const result = await this.dependencies.songSearchService.searchSongs({
      query: schema.query,
      limit: schema.limit,
      offset: schema.offset,
      openkjSystemId: schema.openkjSystemId,
      customerProfileId: context.apiKey.customerProfileId,
    });

    return {
      status: 'ok',
      command: 'songs.search',
      result,
    };
  }

  private parsePayload(
    payload: unknown,
    shape: Record<string, string | [string, undefined]>,
  ): Record<string, any> {
    if (!payload || typeof payload !== 'object') {
      throw createValidationError('Command payload is invalid.');
    }

    const parsed: Record<string, any> = {};

    for (const [key, type] of Object.entries(shape)) {
      const value = (payload as Record<string, unknown>)[key];

      if (Array.isArray(type)) {
        const [expected, optional] = type;
        if (value === undefined) {
          parsed[key] = optional;
          continue;
        }
        if (typeof value !== expected) {
          throw createValidationError(`Field "${key}" must be of type ${expected}.`);
        }
        parsed[key] = value;
        continue;
      }

      if (typeof value !== type) {
        throw createValidationError(`Field "${key}" must be of type ${type}.`);
      }

      parsed[key] = value;
    }

    return parsed;
  }
}
