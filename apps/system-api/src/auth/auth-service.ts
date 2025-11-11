import { createHash, randomBytes } from 'crypto';

import { OrganizationUserStatus, BrandingOwnerType, BrandingStatus } from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';

import { hashPassword, verifyPassword } from './password-hasher';
import type { TokenService } from './token-service';
import type { AccessTokenActiveContext } from './types';
import type { PermissionService } from './permission-service';

const PASSWORD_ALGORITHM = 'argon2id';
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'EMAIL_EXISTS' | 'INVALID_CREDENTIALS' | 'INVALID_TOKEN' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export type RegisterInput = {
  email: string;
  password: string;
  name?: string | null;
  displayName?: string | null;
  accountType?: 'customer' | 'singer' | 'user';
  organizationName?: string | null;
};

export type SignInResult = Awaited<ReturnType<TokenService['createSession']>>;

export type RegisterResult = {
  userId: string;
  session: SignInResult;
};

export type ProfileResult = {
  user: {
    id: string;
    email: string;
    name: string | null;
    displayName: string | null;
    globalRoles: string[];
    isEmailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  organizations: Array<{
    id: string;
    name: string | null;
    roleSlug: string | null;
    permissions: string[];
    permissionsVersion: string | null;
  }>;
  singerProfile: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    preferences: unknown;
  } | null;
  activeContext: AccessTokenActiveContext | null;
  branding: {
    platform: {
      id: string;
      name: string;
      logoUrl: string | null;
      colorPalette: unknown;
    } | null;
  };
};

type AuthServiceDependencies = {
  prisma: PrismaClient;
  tokenService: TokenService;
  permissionService: PermissionService;
};

export class AuthService {
  constructor(private readonly deps: AuthServiceDependencies) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = await this.deps.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AuthServiceError('Email already registered.', 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const result = await this.deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          passwordAlgo: PASSWORD_ALGORITHM,
          name: input.name ?? null,
          displayName: input.displayName ?? null,
          isEmailVerified: false,
        },
      });

      if (input.accountType === 'customer') {
        const customerProfile = await tx.customerProfile.create({
          data: {
            userId: user.id,
            legalBusinessName: input.organizationName ?? input.name ?? null,
            dbaName: input.organizationName ?? null,
            contactEmail: normalizedEmail,
          },
        });

        const customerAdminRole = await tx.role.findUnique({ where: { slug: 'customer-admin' } });

        await tx.organizationUser.create({
          data: {
            customerProfileId: customerProfile.id,
            userId: user.id,
            roleId: customerAdminRole?.id ?? null,
            status: OrganizationUserStatus.active,
          },
        });
      }

      if (input.accountType === 'singer') {
        await tx.singerProfile.create({
          data: {
            userId: user.id,
            nickname: input.displayName ?? null,
          },
        });

        const singerRole = await tx.role.findUnique({ where: { slug: 'singer' } });
        if (singerRole) {
          await tx.userRole.create({
            data: {
              userId: user.id,
              roleId: singerRole.id,
            },
          });
        }
      }

      return { userId: user.id };
    });

    const session = await this.deps.tokenService.createSession(result.userId);
    return { userId: result.userId, session };
  }

  async registerSinger(input: RegisterInput): Promise<RegisterResult> {
    return this.register({ ...input, accountType: 'singer' });
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.deps.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.passwordHash || user.passwordAlgo !== PASSWORD_ALGORITHM) {
      throw new AuthServiceError('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      throw new AuthServiceError('Invalid credentials.', 'INVALID_CREDENTIALS');
    }

    await this.deps.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.deps.tokenService.createSession(user.id);
  }

  async signOut(userId: string, refreshToken: string): Promise<void> {
    const verification = await this.deps.tokenService.verifyRefreshToken(userId, refreshToken);
    if (!verification) {
      return;
    }

    await this.deps.tokenService.revokeRefreshToken(userId, verification.tokenId);
  }

  async switchContext(userId: string, context: AccessTokenActiveContext) {
    return this.deps.tokenService.createAccessToken(userId, context);
  }

  async getProfile(
    userId: string,
    activeContext: AccessTokenActiveContext | null,
  ): Promise<ProfileResult> {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
        organizationUsers: {
          where: { status: OrganizationUserStatus.active },
          include: {
            customerProfile: true,
            role: true,
          },
        },
        singerProfile: true,
      },
    });

    if (!user) {
      throw new AuthServiceError('User not found.', 'NOT_FOUND');
    }

    const globalRoles = user.userRoles
      .map((entry: (typeof user.userRoles)[number]) => entry.role?.slug)
      .filter((role): role is string => Boolean(role))
      .sort();

    const organizations: ProfileResult['organizations'] = [];

    for (const membership of user.organizationUsers) {
      const permissionSet = await this.deps.permissionService.getOrganizationPermissions(userId, {
        id: membership.customerProfileId,
        roles: membership.role?.slug ? [membership.role.slug] : [],
      });

      organizations.push({
        id: membership.customerProfileId,
        name:
          membership.customerProfile?.dbaName ??
          membership.customerProfile?.legalBusinessName ??
          null,
        roleSlug: membership.role?.slug ?? null,
        permissions: permissionSet?.permissions ?? [],
        permissionsVersion: permissionSet?.version ?? null,
      });
    }

    const singerProfile = user.singerProfile
      ? {
          id: user.singerProfile.id,
          nickname: user.singerProfile.nickname,
          avatarUrl: user.singerProfile.avatarUrl,
          preferences: user.singerProfile.preferences,
        }
      : null;

    const platformBranding = await this.deps.prisma.brandingProfile.findFirst({
      where: {
        ownerType: BrandingOwnerType.platform,
        status: BrandingStatus.active,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        globalRoles,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      organizations,
      singerProfile,
      activeContext,
      branding: {
        platform: platformBranding
          ? {
              id: platformBranding.id,
              name: platformBranding.name,
              logoUrl: platformBranding.logoUrl,
              colorPalette: platformBranding.colorPalette,
            }
          : null,
      },
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.deps.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (!user) {
      return;
    }

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
    const token = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(token).digest('hex');

    await this.deps.prisma.verificationToken.deleteMany({ where: { identifier: normalizedEmail } });

    await this.deps.prisma.verificationToken.create({
      data: {
        identifier: normalizedEmail,
        token: hashedToken,
        expiresAt,
      },
    });

    // TODO: enqueue password reset email via BullMQ worker
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const hashedToken = createHash('sha256').update(token).digest('hex');

    const stored = await this.deps.prisma.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: normalizedEmail,
          token: hashedToken,
        },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AuthServiceError('Invalid or expired password reset token.', 'INVALID_TOKEN');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingUser = await tx.user.findUnique({ where: { email: normalizedEmail } });
      if (!existingUser) {
        throw new AuthServiceError('User not found.', 'NOT_FOUND');
      }

      await tx.user.update({
        where: { email: normalizedEmail },
        data: {
          passwordHash,
          passwordAlgo: PASSWORD_ALGORITHM,
        },
      });

      await tx.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: normalizedEmail,
            token: hashedToken,
          },
        },
      });
    });
  }
}
