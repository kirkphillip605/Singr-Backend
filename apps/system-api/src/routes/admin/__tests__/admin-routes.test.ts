import Fastify from 'fastify';
import type { Registry } from 'prom-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('problem-json', () => ({
  createProblemDocument: (problem: unknown) => problem,
}));

import { registerAdminRoutes } from '..';

class AuthorizationStub {
  constructor(private readonly options: { userId: string; roles: string[] }) {}

  get activeContext() {
    return null;
  }

  requireUser() {
    return { id: this.options.userId };
  }

  hasGlobalRole(role: string) {
    return this.options.roles.includes(role);
  }

  hasAnyGlobalRole(roles: Iterable<string>) {
    for (const role of roles) {
      if (this.hasGlobalRole(role)) {
        return true;
      }
    }

    return false;
  }
}

describe('Admin routes', () => {
  const userService = {
    listUsers: vi.fn(),
    updateUserRoles: vi.fn(),
  };
  const organizationService = {
    listOrganizations: vi.fn(),
    updateOrganization: vi.fn(),
  };
  const roleService = {
    listRoles: vi.fn(),
    updateRolePermissions: vi.fn(),
  };
  const brandingService = {
    listBrandingProfiles: vi.fn(),
    updateBrandingProfile: vi.fn(),
  };
  const stripeService = {
    listEvents: vi.fn(),
    getEvent: vi.fn(),
    retrieveRemoteEvent: vi.fn(),
  };

  const metricsRegistryMock = vi.fn<[], Promise<string>>();
  const metricsRegistry = {
    contentType: 'text/plain',
    metrics: metricsRegistryMock,
  } as unknown as Registry;

  let app: ReturnType<typeof Fastify>;
  let authorization: AuthorizationStub;

  beforeAll(async () => {
    app = Fastify();
    (app as unknown as { authenticate: () => Promise<void> }).authenticate = async () => {};
    app.addHook('onRequest', async (request) => {
      (request as unknown as { authorization: AuthorizationStub }).authorization = authorization;
    });

    await registerAdminRoutes(app, {
      userService: userService as never,
      organizationService: organizationService as never,
      roleService: roleService as never,
      brandingService: brandingService as never,
      stripeService: stripeService as never,
      metricsRegistry,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authorization = new AuthorizationStub({ userId: 'user-1', roles: ['platform-admin'] });
  });

  it('allows global admins to list users', async () => {
    userService.listUsers.mockResolvedValueOnce([{ id: 'user-1', email: 'test@example.com' }]);

    const response = await app.inject({ method: 'GET', url: '/v1/admin/users' });

    expect(response.statusCode).toBe(200);
    expect(userService.listUsers).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({ data: [{ id: 'user-1', email: 'test@example.com' }] });
  });

  it('rejects non-admin access to admin endpoints', async () => {
    authorization = new AuthorizationStub({ userId: 'user-2', roles: [] });

    const response = await app.inject({ method: 'GET', url: '/v1/admin/users' });

    expect(response.statusCode).toBe(403);
    expect(userService.listUsers).not.toHaveBeenCalled();
  });

  it('updates user roles for admins', async () => {
    userService.updateUserRoles.mockResolvedValueOnce({ id: 'user-3', globalRoles: ['platform-admin'] });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/admin/users/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/roles',
      payload: { roles: ['platform-admin'] },
    });

    expect(response.statusCode).toBe(200);
    expect(userService.updateUserRoles).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ['platform-admin'],
    );
  });

  it('restricts metrics to admins', async () => {
    metricsRegistryMock.mockResolvedValueOnce('metric-data');

    const response = await app.inject({ method: 'GET', url: '/v1/admin/metrics' });

    expect(response.statusCode).toBe(200);
    expect(metricsRegistryMock).toHaveBeenCalled();
    expect(response.body).toBe('metric-data');

    authorization = new AuthorizationStub({ userId: 'user-4', roles: [] });
    const forbidden = await app.inject({ method: 'GET', url: '/v1/admin/metrics' });
    expect(forbidden.statusCode).toBe(403);
  });
});
