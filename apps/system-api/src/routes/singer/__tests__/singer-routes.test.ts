import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('problem-json', () => ({
  createProblemDocument: (problem: unknown) => problem,
}));

import { registerSingerRoutes } from '..';

class AuthorizationStub {
  constructor(private readonly options: { userId: string; singerProfileId: string; hasSingerRole: boolean }) {}

  get activeContext() {
    return this.options.hasSingerRole
      ? { type: 'singer' as const, id: this.options.singerProfileId }
      : null;
  }

  requireUser() {
    return { id: this.options.userId };
  }

  hasGlobalRole(role: string) {
    return role === 'singer' ? this.options.hasSingerRole : false;
  }
}

describe('Singer routes', () => {
  const profileService = {
    requireProfile: vi.fn(),
    updateProfile: vi.fn(),
  };
  const requestService = {
    createRequest: vi.fn(),
  };
  const favoritesService = {
    listFavoriteSongs: vi.fn(),
    addFavoriteSong: vi.fn(),
    removeFavoriteSong: vi.fn(),
    listFavoriteVenues: vi.fn(),
    addFavoriteVenue: vi.fn(),
    removeFavoriteVenue: vi.fn(),
  };
  const historyService = {
    listHistory: vi.fn(),
  };

  let app: ReturnType<typeof Fastify>;
  let authContext: AuthorizationStub;

  beforeAll(async () => {
    app = Fastify();
    (app as unknown as { authenticate: () => Promise<void> }).authenticate = async () => {};
    app.addHook('onRequest', async (request) => {
      (request as unknown as { authorization: AuthorizationStub }).authorization = authContext;
    });

    await registerSingerRoutes(app, {
      profileService: profileService as never,
      requestService: requestService as never,
      favoritesService: favoritesService as never,
      historyService: historyService as never,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authContext = new AuthorizationStub({ userId: 'user-1', singerProfileId: 'singer-1', hasSingerRole: true });
  });

  it('returns singer profile', async () => {
    profileService.requireProfile.mockResolvedValueOnce({ id: 'singer-1' });

    const response = await app.inject({ method: 'GET', url: '/v1/singer/profile' });

    expect(response.statusCode).toBe(200);
    expect(profileService.requireProfile).toHaveBeenCalledWith('singer-1');
  });

  it('creates request with singer context enforcement', async () => {
    requestService.createRequest.mockResolvedValueOnce({ id: 'req-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/singer/requests',
      payload: {
        venueId: '11111111-1111-1111-1111-111111111111',
        artist: 'Artist',
        title: 'Title',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(requestService.createRequest).toHaveBeenCalledWith(
      'singer-1',
      expect.objectContaining({ submittedByUserId: 'user-1' }),
    );
  });

  it('rejects requests without singer role', async () => {
    authContext = new AuthorizationStub({ userId: 'user-1', singerProfileId: 'singer-1', hasSingerRole: false });

    const response = await app.inject({ method: 'GET', url: '/v1/singer/favorites/songs' });

    expect(response.statusCode).toBe(403);
    expect(favoritesService.listFavoriteSongs).not.toHaveBeenCalled();
  });
});
