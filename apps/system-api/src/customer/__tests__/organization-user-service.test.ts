import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { OrganizationUserService } from '../organization-user-service';
import type { RedisClient } from '../../lib/redis';
import type { InvitationProducer } from '../../queues/producers';

describe('OrganizationUserService', () => {
  const prismaRaw = {
    organizationUser: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redisMock = redisRaw as unknown as RedisClient;

  const invitationProducerRaw = {
    enqueueInvitation: vi.fn(),
  };
  const invitationProducer = invitationProducerRaw as unknown as InvitationProducer;

  let service: OrganizationUserService;

  beforeEach(() => {
    service = new OrganizationUserService(prismaMock, redisMock, invitationProducer, {
      cacheTtlSeconds: 45,
      invitationTtlSeconds: 600,
    });
    vi.clearAllMocks();
  });

  it('invites new user and enqueues job', async () => {
    prismaRaw.organizationUser.findFirst.mockResolvedValueOnce(null);
    prismaRaw.organizationUser.create.mockResolvedValueOnce({
      id: 'org-user-1',
      customerProfileId: 'cust-1',
      userId: 'user-1',
      roleId: null,
      status: 'invited',
      invitedByUserId: 'admin-1',
      invitationToken: 'token',
      invitationExpiresAt: new Date(),
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { email: 'user@example.com', name: 'User', displayName: null },
      role: null,
    });

    const invited = await service.inviteUser('cust-1', {
      userId: 'user-1',
      invitedByUserId: 'admin-1',
    });

    expect(invited.status).toBe('invited');
    expect(invitationProducerRaw.enqueueInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationUserId: 'org-user-1',
        invitationExpiresAt: expect.any(String),
      }),
    );
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:organization-users:cust-1:version');
  });

  it('updates user without changes returns hydrated record', async () => {
    prismaRaw.organizationUser.findFirst.mockResolvedValueOnce({
      id: 'org-user-1',
      customerProfileId: 'cust-1',
      userId: 'user-1',
    });
    prismaRaw.organizationUser.findUnique.mockResolvedValueOnce({
      id: 'org-user-1',
      customerProfileId: 'cust-1',
      userId: 'user-1',
      roleId: null,
      status: 'invited',
      invitedByUserId: null,
      invitationToken: 'token',
      invitationExpiresAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { email: 'user@example.com', name: 'User', displayName: null },
      role: null,
    });

    const updated = await service.updateUser('cust-1', 'org-user-1', {});
    expect(updated.id).toBe('org-user-1');
    expect(redisRaw.incr).not.toHaveBeenCalled();
  });
});
