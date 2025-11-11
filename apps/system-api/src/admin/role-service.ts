import type { Permission, PrismaClient, Role } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';

export type AdminRoleDto = {
  id: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
};

export class AdminRoleService {
  constructor(private readonly prisma: PrismaClient) {}

  async listRoles(): Promise<AdminRoleDto[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: { slug: 'asc' },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    return roles.map((role) => this.mapRole(role));
  }

  async updateRolePermissions(roleId: string, permissionSlugs: string[]): Promise<AdminRoleDto> {
    const normalized = Array.from(
      new Set(
        permissionSlugs
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
      ),
    );

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    if (!role) {
      throw createNotFoundError('Role', { roleId });
    }

    const permissions = normalized.length
      ? await this.prisma.permission.findMany({ where: { slug: { in: normalized } } })
      : [];

    if (permissions.length !== normalized.length) {
      const found = new Set(permissions.map((permission) => permission.slug));
      const missing = normalized.filter((slug) => !found.has(slug));
      throw createValidationError('One or more permissions could not be found.', { missingPermissions: missing });
    }

    const permissionIds = permissions.map((permission) => permission.id);

    await this.prisma.$transaction(async (tx) => {
      if (permissionIds.length > 0) {
        await tx.rolePermission.deleteMany({
          where: {
            roleId,
            permissionId: { notIn: permissionIds },
          },
        });
      } else {
        await tx.rolePermission.deleteMany({ where: { roleId } });
      }

      const existing = await tx.rolePermission.findMany({
        where: { roleId },
        select: { permissionId: true },
      });
      const existingIds = new Set(existing.map((entry) => entry.permissionId));

      for (const permissionId of permissionIds) {
        if (!existingIds.has(permissionId)) {
          await tx.rolePermission.create({
            data: { roleId, permissionId },
          });
        }
      }
    });

    const updated = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    if (!updated) {
      throw createNotFoundError('Role', { roleId });
    }

    return this.mapRole(updated);
  }

  private mapRole(role: Role & { rolePermissions: { permission: Permission | null }[] }): AdminRoleDto {
    const permissions = role.rolePermissions
      .map((entry) => entry.permission?.slug)
      .filter((slug): slug is string => Boolean(slug))
      .sort();

    return {
      id: role.id,
      slug: role.slug,
      description: role.description ?? null,
      isSystem: role.isSystem,
      permissions,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    };
  }
}
