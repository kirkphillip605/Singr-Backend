import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeyValidationResult } from '../../customer/api-key-service';
import { OpenKjCommandService } from '../command-service';

describe('OpenKjCommandService', () => {
  const apiKeyService = {
    validateSecret: vi.fn<[], any>(),
  };
  const venueSearchService = {
    searchNearby: vi.fn(),
  };
  const songSearchService = {
    searchSongs: vi.fn(),
  };

  let service: OpenKjCommandService;

  beforeEach(() => {
    service = new OpenKjCommandService({
      apiKeyService: apiKeyService as any,
      venueSearchService: venueSearchService as any,
      songSearchService: songSearchService as any,
    });
    vi.clearAllMocks();
  });

  it('returns error when API key validation fails', async () => {
    apiKeyService.validateSecret.mockResolvedValue(null);

    const response = await service.execute({ apiKey: 'bad', command: 'ping' });
    expect(response.status).toBe('error');
    expect(response.error?.code).toBe('invalid_api_key');
  });

  it('handles ping command', async () => {
    apiKeyService.validateSecret.mockResolvedValue({
      id: 'key-1',
      customerProfileId: 'cust-1',
      customerId: null,
      description: null,
      metadata: {},
    } satisfies ApiKeyValidationResult);

    const response = await service.execute({ apiKey: 'valid', command: 'ping' });
    expect(response.status).toBe('ok');
    expect(response.result).toMatchObject({ message: 'pong', customerProfileId: 'cust-1' });
  });

  it('executes venues.nearby command with customer context', async () => {
    const apiKey: ApiKeyValidationResult = {
      id: 'key-1',
      customerProfileId: 'cust-1',
      customerId: null,
      description: null,
      metadata: {},
    };
    apiKeyService.validateSecret.mockResolvedValue(apiKey);
    venueSearchService.searchNearby.mockResolvedValue({ data: [] });

    const response = await service.execute({
      apiKey: 'valid',
      command: 'venues.nearby',
      payload: { latitude: 30, longitude: -97, limit: 5 },
    });

    expect(response.status).toBe('ok');
    expect(venueSearchService.searchNearby).toHaveBeenCalledWith({
      latitude: 30,
      longitude: -97,
      limit: 5,
      radiusMeters: undefined,
      acceptingRequests: undefined,
      customerProfileId: 'cust-1',
    });
  });

  it('executes songs.search command using normalized payload', async () => {
    const apiKey: ApiKeyValidationResult = {
      id: 'key-1',
      customerProfileId: 'cust-1',
      customerId: null,
      description: null,
      metadata: {},
    };
    apiKeyService.validateSecret.mockResolvedValue(apiKey);
    songSearchService.searchSongs.mockResolvedValue({ data: [], pagination: { limit: 10, offset: 0, total: 0 }, query: {} });

    const response = await service.execute({
      apiKey: 'valid',
      command: 'songs.search',
      payload: { query: 'Hello World', limit: 10 },
    });

    expect(response.status).toBe('ok');
    expect(songSearchService.searchSongs).toHaveBeenCalledWith({
      query: 'Hello World',
      limit: 10,
      offset: undefined,
      openkjSystemId: undefined,
      customerProfileId: 'cust-1',
    });
    expect(response.result).toMatchObject({ pagination: { limit: 10 } });
  });
});
