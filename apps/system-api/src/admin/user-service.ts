import type { Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError, createValidationError } from '../http/problem';

export type AdminUserDto = {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  globalRoles: string[];
  customerProfileId: string | null;
};

export class AdminUserService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(): Promise<AdminUserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: adminUserInclude,
    });

    return users.map((user) => this.mapUser(user));
  }

  async updateUserRoles(userId: string, roleSlugs: string[]): Promise<AdminUserDto> {
    const normalizedSlugs = Array.from(
      new Set(
        roleSlugs
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
      ),
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw createNotFoundError('User', { userId });
    }

    const roles = await this.prisma.role.findMany({
      where: {
        slug: { in: normalizedSlugs },
      },
      select: { id: true, slug: true },
    });

    if (roles.length !== normalizedSlugs.length) {
      const found = new Set(roles.map((role) => role.slug));
      const missing = normalizedSlugs.filter((slug) => !found.has(slug));
      throw createValidationError('One or more roles could not be found.', { missingRoles: missing });
    }

    const roleIds = roles.map((role) => role.id);

    await this.prisma.$transaction(async (tx) => {
      if (roleIds.length > 0) {
        await tx.userRole.deleteMany({
          where: {
            userId,
            roleId: { notIn: roleIds },
          },
        });
      } else {
        await tx.userRole.deleteMany({ where: { userId } });
      }

      const existingAssignments = await tx.userRole.findMany({
        where: { userId },
        select: { roleId: true },
      });
      const existingRoleIds = new Set(existingAssignments.map((assignment) => assignment.roleId));

      for (const roleId of roleIds) {
        if (!existingRoleIds.has(roleId)) {
          await tx.userRole.create({
            data: { userId, roleId },
          });
        }
      }
    });

    const updated = await this.prisma.user.findUnique({
      where: { id: userId },
      include: adminUserInclude,
    });

    if (!updated) {
      throw createNotFoundError('User', { userId });
    }

    return this.mapUser(updated);
  }

  private mapUser(user: Prisma.UserGetPayload<typeof adminUserArgs>): AdminUserDto {
    const roles = user.userRoles.map((assignment) => assignment.role?.slug).filter(Boolean) as string[];

    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      displayName: user.displayName ?? null,
      phoneNumber: user.phoneNumber ?? null,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      globalRoles: roles.sort(),
      customerProfileId: user.customerProfile?.id ?? null,
    };
  }
}

const adminUserInclude = {
  userRoles: {
    include: {
      role: true,
    },
  },
  customerProfile: {
    select: { id: true },
  },
} satisfies Prisma.UserFindManyArgs['include'];

const adminUserArgs = {
  include: adminUserInclude,
} satisfies Prisma.UserFindManyArgs;
