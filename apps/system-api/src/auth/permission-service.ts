import type { Redis } from 'ioredis';

import type { PrismaClient } from '@prisma/client';

import type { AccessTokenOrganizationClaim } from './types';
import { computePermissionCacheVersion } from '../lib/prisma';

const PERMISSION_CACHE_PREFIX = 'permissions';
const PERMISSION_CACHE_TTL_SECONDS = 300;

export type OrganizationPermissionSet = {
  organizationId: string;
  roleSlug: string | null;
  permissions: string[];
  version: string;
};

export class PermissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async getOrganizationPermissions(
    userId: string,
    organization: AccessTokenOrganizationClaim,
  ): Promise<OrganizationPermissionSet | null> {
    const cacheKey = this.buildCacheKey(userId, organization.id, organization.permissionsHash);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as OrganizationPermissionSet;
    }

    const membership = await this.prisma.organizationUser.findUnique({
      where: {
        customerProfileId_userId: {
          customerProfileId: organization.id,
          userId,
        },
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    const rolePermissions = membership.role?.rolePermissions ?? [];
    const directPermissions = membership.permissions ?? [];

    const permissions = new Set<string>();
    for (const rolePermission of rolePermissions) {
      if (rolePermission.permission?.slug) {
        permissions.add(rolePermission.permission.slug);
      }
    }
    for (const entry of directPermissions) {
      if (entry.permission?.slug) {
        permissions.add(entry.permission.slug);
      }
    }

    const version = computePermissionCacheVersion(
      membership.role?.slug ?? null,
      permissions,
      membership.updatedAt,
    );

    const payload: OrganizationPermissionSet = {
      organizationId: organization.id,
      roleSlug: membership.role?.slug ?? null,
      permissions: Array.from(permissions).sort(),
      version,
    };

    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', PERMISSION_CACHE_TTL_SECONDS);

    if (version !== (organization.permissionsHash ?? 'v0')) {
      const derivedKey = this.buildCacheKey(userId, organization.id, version);
      await this.redis.set(derivedKey, JSON.stringify(payload), 'EX', PERMISSION_CACHE_TTL_SECONDS);
    }

    return payload;
  }

  private buildCacheKey(userId: string, organizationId: string, versionHint?: string | null) {
    const version = versionHint ?? 'v0';
    return `${PERMISSION_CACHE_PREFIX}:${userId}:${organizationId}:${version}`;
  }
}
