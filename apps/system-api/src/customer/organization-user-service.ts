import { randomUUID } from 'crypto';

import type {
  OrganizationUserStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';
import type { RedisClient } from '../lib/redis';
import type { InvitationProducer } from '../queues/producers';

export type OrganizationUserDto = {
  id: string;
  customerProfileId: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  roleId: string | null;
  roleSlug: string | null;
  status: OrganizationUserStatus;
  invitedByUserId: string | null;
  invitationToken: string | null;
  invitationExpiresAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InviteOrganizationUserInput = {
  userId: string;
  roleId?: string | null;
  invitedByUserId?: string | null;
};

export type UpdateOrganizationUserInput = {
  roleId?: string | null;
  status?: OrganizationUserStatus;
  invitationExpiresAt?: Date | null;
};

type OrganizationUserServiceOptions = {
  cacheTtlSeconds?: number;
  invitationTtlSeconds?: number;
};

export class OrganizationUserService {
  private readonly cacheTtlSeconds: number;
  private readonly invitationTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    private readonly invitationProducer: InvitationProducer,
    options: OrganizationUserServiceOptions = {},
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this.invitationTtlSeconds = options.invitationTtlSeconds ?? 86_400;
  }

  async listOrganizationUsers(customerProfileId: string): Promise<OrganizationUserDto[]> {
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildListCacheKey(customerProfileId, version);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as OrganizationUserDto[];
    }

    const users = await this.prisma.organizationUser.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: 'asc' },
      select: organizationUserSelect,
    });

    const data = users.map((user) => this.mapModelToDto(user));
    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', this.cacheTtlSeconds);

    return data;
  }

  async inviteUser(
    customerProfileId: string,
    input: InviteOrganizationUserInput,
  ): Promise<OrganizationUserDto> {
    const existing = await this.prisma.organizationUser.findFirst({
      where: { customerProfileId, userId: input.userId },
    });

    if (existing) {
      throw createValidationError('User is already a member of this organization.');
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + this.invitationTtlSeconds * 1000);

    const created = await this.prisma.organizationUser.create({
      data: {
        customerProfileId,
        userId: input.userId,
        roleId: input.roleId ?? null,
        invitedByUserId: input.invitedByUserId ?? null,
        invitationToken: token,
        invitationExpiresAt: expiresAt,
        status: 'invited',
      },
      select: organizationUserSelect,
    });

    await this.invitationProducer.enqueueInvitation({
      organizationUserId: created.id,
      customerProfileId,
      email: created.user?.email ?? null,
      invitationToken: created.invitationToken,
    });

    await this.bumpCacheVersion(customerProfileId);

    return this.mapModelToDto(created);
  }

  async updateUser(
    customerProfileId: string,
    organizationUserId: string,
    input: UpdateOrganizationUserInput,
  ): Promise<OrganizationUserDto> {
    const existing = await this.prisma.organizationUser.findFirst({
      where: { id: organizationUserId, customerProfileId },
    });

    if (!existing) {
      throw createNotFoundError('Organization user', { organizationUserId });
    }

    const data: Prisma.OrganizationUserUpdateInput = {};

    if (input.roleId !== undefined) {
      data.roleId = input.roleId;
    }

    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'active') {
        data.invitationToken = null;
        data.invitationExpiresAt = null;
      }
    }

    if (input.invitationExpiresAt !== undefined) {
      data.invitationExpiresAt = input.invitationExpiresAt;
    }

    if (Object.keys(data).length === 0) {
      const hydrated = await this.prisma.organizationUser.findUnique({
        where: { id: existing.id },
        select: organizationUserSelect,
      });

      if (!hydrated) {
        throw createNotFoundError('Organization user', { organizationUserId });
      }

      return this.mapModelToDto(hydrated);
    }

    const updated = await this.prisma.organizationUser.update({
      where: { id: existing.id },
      data,
      select: organizationUserSelect,
    });

    await this.bumpCacheVersion(customerProfileId);

    return this.mapModelToDto(updated);
  }

  async removeUser(customerProfileId: string, organizationUserId: string): Promise<void> {
    const result = await this.prisma.organizationUser.deleteMany({
      where: { id: organizationUserId, customerProfileId },
    });

    if (result.count === 0) {
      throw createNotFoundError('Organization user', { organizationUserId });
    }

    await this.bumpCacheVersion(customerProfileId);
  }

  private mapModelToDto(
    model: Prisma.OrganizationUserGetPayload<{ select: typeof organizationUserSelect }>,
  ): OrganizationUserDto {
    return {
      id: model.id,
      customerProfileId: model.customerProfileId,
      userId: model.userId,
      email: model.user?.email ?? null,
      displayName: model.user?.displayName ?? model.user?.name ?? null,
      roleId: model.roleId,
      roleSlug: model.role?.slug ?? null,
      status: model.status,
      invitedByUserId: model.invitedByUserId,
      invitationToken: model.invitationToken ?? null,
      invitationExpiresAt: model.invitationExpiresAt
        ? model.invitationExpiresAt.toISOString()
        : null,
      lastAccessedAt: model.lastAccessedAt ? model.lastAccessedAt.toISOString() : null,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private buildListCacheKey(customerProfileId: string, version: number): string {
    return `cache:organization-users:${customerProfileId}:v${version}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:organization-users:${customerProfileId}:version`;
  }

  private async getCacheVersion(customerProfileId: string): Promise<number> {
    const key = this.getCacheVersionKey(customerProfileId);
    const value = await this.redis.get(key);
    return value ? Number(value) : 0;
  }

  private async bumpCacheVersion(customerProfileId: string): Promise<void> {
    const key = this.getCacheVersionKey(customerProfileId);
    await this.redis.incr(key);
  }
}

const organizationUserSelect = {
  id: true,
  customerProfileId: true,
  userId: true,
  roleId: true,
  status: true,
  invitedByUserId: true,
  invitationToken: true,
  invitationExpiresAt: true,
  lastAccessedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      displayName: true,
    },
  },
  role: {
    select: {
      id: true,
      slug: true,
    },
  },
} satisfies Prisma.OrganizationUserSelect;
