import { randomUUID } from 'crypto';

import { SignJWT, importPKCS8, type JWTPayload, type KeyLike } from 'jose';

import type { PrismaClient } from '@prisma/client';
import { OrganizationUserStatus } from '@prisma/client';

import type { AppConfig } from '../config';
import type { PermissionService } from './permission-service';
import type {
  AccessTokenActiveContext,
  AccessTokenClaims,
  AccessTokenOrganizationClaim,
} from './types';
import type { RefreshTokenStore, IssuedRefreshToken } from './refresh-token-store';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_ALGORITHM = 'ES256';
export const JWT_AUDIENCE = 'system.singrkaraoke.com';
const JWT_ISSUER = 'https://system.singrkaraoke.com';

type TokenServiceDependencies = {
  config: AppConfig;
  prisma: PrismaClient;
  permissionService: PermissionService;
  refreshTokenStore: RefreshTokenStore;
};

type SessionResult = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: IssuedRefreshToken;
  claims: AccessTokenClaims;
};

type AccessTokenResult = {
  accessToken: string;
  accessTokenExpiresAt: number;
  claims: AccessTokenClaims;
};

type ActiveContextOverride = AccessTokenActiveContext | null | undefined;

export class TokenService {
  private readonly privateKeyPromise: Promise<KeyLike>;

  constructor(private readonly deps: TokenServiceDependencies) {
    this.privateKeyPromise = importPKCS8(
      this.deps.config.auth.jwtPrivateKey,
      JWT_ALGORITHM,
    ) as Promise<KeyLike>;
  }

  async createSession(
    userId: string,
    activeContext?: ActiveContextOverride,
  ): Promise<SessionResult> {
    const claims = await this.buildAccessTokenClaims(userId, activeContext);
    const [accessToken, refreshToken] = await Promise.all([
      this.signJwt(claims),
      this.deps.refreshTokenStore.issue(userId),
    ]);

    return {
      accessToken,
      accessTokenExpiresAt: claims.exp,
      refreshToken,
      claims,
    };
  }

  async createAccessToken(
    userId: string,
    activeContext?: ActiveContextOverride,
  ): Promise<AccessTokenResult> {
    const claims = await this.buildAccessTokenClaims(userId, activeContext);
    const accessToken = await this.signJwt(claims);

    return {
      accessToken,
      accessTokenExpiresAt: claims.exp,
      claims,
    };
  }

  async rotateRefreshToken(userId: string, token: string): Promise<IssuedRefreshToken | null> {
    return this.deps.refreshTokenStore.rotate(userId, token);
  }

  async revokeRefreshToken(userId: string, tokenId: string): Promise<void> {
    await this.deps.refreshTokenStore.revoke(userId, tokenId);
  }

  async verifyRefreshToken(userId: string, token: string): Promise<{ tokenId: string } | null> {
    return this.deps.refreshTokenStore.verify(userId, token);
  }

  private async signJwt(payload: JWTPayload): Promise<string> {
    const key = await this.privateKeyPromise;
    return new SignJWT(payload)
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setAudience(JWT_AUDIENCE)
      .setIssuer(JWT_ISSUER)
      .sign(key);
  }

  private async buildAccessTokenClaims(
    userId: string,
    activeContextOverride?: ActiveContextOverride,
  ): Promise<AccessTokenClaims> {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
        organizationUsers: {
          where: {
            status: OrganizationUserStatus.active,
          },
          include: {
            role: true,
          },
        },
        customerProfile: true,
        singerProfile: true,
      },
    });

    if (!user) {
      throw new Error('User not found when building access token claims.');
    }

    const globalRoles = new Set<string>();
    for (const userRole of user.userRoles) {
      if (userRole.role?.slug) {
        globalRoles.add(userRole.role.slug);
      }
    }

    const organizationClaims = await this.buildOrganizationClaims(userId, user.organizationUsers);
    const activeContext = await this.resolveActiveContext(
      userId,
      activeContextOverride,
      user.customerProfile?.id ?? null,
      user.singerProfile?.id ?? null,
      organizationClaims,
    );

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiration = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
    const rolesArray = Array.from(globalRoles).sort();

    const claims: AccessTokenClaims = {
      sub: user.id,
      email: user.email,
      aud: JWT_AUDIENCE,
      iss: JWT_ISSUER,
      iat: issuedAt,
      exp: expiration,
      jti: randomUUID(),
      roles: rolesArray,
      organizations: organizationClaims,
      activeContext: activeContext ?? undefined,
    };

    return claims;
  }

  private async buildOrganizationClaims(
    userId: string,
    memberships: {
      customerProfileId: string;
      role: { slug: string | null } | null;
    }[],
  ): Promise<AccessTokenOrganizationClaim[]> {
    if (memberships.length === 0) {
      return [];
    }

    const claimPromises = memberships.map(async (membership) => {
      const claim: AccessTokenOrganizationClaim = {
        id: membership.customerProfileId,
        roles: membership.role?.slug ? [membership.role.slug] : [],
      };

      const permissionSet = await this.deps.permissionService.getOrganizationPermissions(
        userId,
        claim,
      );

      if (permissionSet) {
        claim.permissionsHash = permissionSet.version;
      }

      return claim;
    });

    const claims = await Promise.all(claimPromises);
    return claims.sort((a, b) => a.id.localeCompare(b.id));
  }

  private async resolveActiveContext(
    userId: string,
    override: ActiveContextOverride,
    ownedCustomerId: string | null,
    singerProfileId: string | null,
    organizations: AccessTokenOrganizationClaim[],
  ): Promise<AccessTokenActiveContext | null> {
    if (override) {
      await this.validateActiveContext(userId, override, singerProfileId, organizations);
      return override;
    }

    if (ownedCustomerId) {
      return { type: 'customer', id: ownedCustomerId };
    }

    if (organizations.length > 0) {
      return { type: 'customer', id: organizations[0]!.id };
    }

    if (singerProfileId) {
      return { type: 'singer', id: singerProfileId };
    }

    return null;
  }

  private async validateActiveContext(
    userId: string,
    context: AccessTokenActiveContext,
    singerProfileId: string | null,
    organizations: AccessTokenOrganizationClaim[],
  ) {
    if (context.type === 'customer') {
      const isMember = organizations.some((org) => org.id === context.id);
      if (isMember) {
        return;
      }

      const ownedProfile = await this.deps.prisma.customerProfile.findFirst({
        where: {
          id: context.id,
          userId,
        },
      });

      if (!ownedProfile) {
        throw new Error('User does not have access to requested customer context.');
      }

      return;
    }

    if (context.type === 'singer') {
      if (singerProfileId === context.id) {
        return;
      }

      throw new Error('User does not have access to requested singer context.');
    }

    throw new Error('Unsupported active context type.');
  }
}
