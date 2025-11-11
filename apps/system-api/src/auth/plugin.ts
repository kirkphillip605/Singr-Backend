import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config';
import { createAuthenticationError, createAuthorizationError } from '../http/problem';
import { setActiveUser } from '../http/request-context';
import type { PermissionService, OrganizationPermissionSet } from './permission-service';
import type { TokenVerifier } from './token-verifier';
import type {
  AccessTokenOrganizationClaim,
  AuthenticatedOrganization,
  AuthenticatedUser,
} from './types';

const AUTH_HEADER = 'authorization';
const BEARER_PREFIX = 'bearer ';
const GLOBAL_ADMIN_ROLES = new Set(['platform-admin']);

export type AuthenticationPluginOptions = {
  config: AppConfig;
  tokenVerifier: TokenVerifier;
  permissionService: PermissionService;
};

export type OrganizationPermissionOptions = {
  organizationId?: string;
  useActiveContext?: boolean;
  allowGlobalAdmin?: boolean;
  requireOrganizationRole?: string | string[];
};

class AuthorizationContext {
  constructor(
    private readonly user: AuthenticatedUser | null,
    private readonly authError: Error | null,
  ) {}

  get authenticatedUser(): AuthenticatedUser | null {
    return this.user;
  }

  get activeContext() {
    return this.user?.activeContext ?? null;
  }

  requireUser(): AuthenticatedUser {
    if (this.user) {
      return this.user;
    }

    if (this.authError) {
      throw createAuthenticationError(this.authError.message, this.authError);
    }

    throw createAuthenticationError();
  }

  hasGlobalRole(role: string): boolean {
    return this.user?.globalRoles.has(role) ?? false;
  }

  hasAnyGlobalRole(roles: Iterable<string>): boolean {
    if (!this.user) {
      return false;
    }

    for (const role of roles) {
      if (this.user.globalRoles.has(role)) {
        return true;
      }
    }

    return false;
  }

  hasOrganizationPermission(organizationId: string, permission: string): boolean {
    if (!this.user) {
      return false;
    }

    const organization = this.user.organizations.get(organizationId);
    if (!organization) {
      return false;
    }

    return organization.permissions.has(permission);
  }

  requireOrganizationPermission(permission: string, options: OrganizationPermissionOptions = {}) {
    const user = this.requireUser();

    if (options.allowGlobalAdmin !== false && this.hasAnyGlobalRole(GLOBAL_ADMIN_ROLES)) {
      return;
    }

    const organizationId = this.resolveOrganizationId(user, options);

    if (!organizationId) {
      throw createAuthorizationError('Organization context is required to check permissions.', {
        permission,
      });
    }

    const organization = user.organizations.get(organizationId);
    if (!organization) {
      throw createAuthorizationError('You are not a member of this organization.', {
        organizationId,
        permission,
      });
    }

    const requiredRoles = normalizeRoles(options.requireOrganizationRole);
    if (requiredRoles && requiredRoles.size > 0) {
      const hasRole = requiredRoles.has(organization.roleSlug ?? '');
      if (!hasRole) {
        throw createAuthorizationError('Missing required organization role.', {
          organizationId,
          permission,
          requiredRoles: Array.from(requiredRoles),
        });
      }
    }

    if (!organization.permissions.has(permission)) {
      throw createAuthorizationError('Missing required permission.', {
        organizationId,
        permission,
      });
    }
  }

  private resolveOrganizationId(
    user: AuthenticatedUser,
    options: OrganizationPermissionOptions,
  ): string | null {
    if (options.organizationId) {
      return options.organizationId;
    }

    if (options.useActiveContext && user.activeContext?.type === 'customer') {
      return user.activeContext.id;
    }

    return null;
  }
}

export async function registerAuthenticationPlugin(
  app: FastifyInstance,
  options: AuthenticationPluginOptions,
) {
  const { tokenVerifier, permissionService } = options;

  app.decorate('authenticate', async function authenticate(request: FastifyRequest) {
    if (request.authUser) {
      return;
    }

    if (request.authError) {
      throw createAuthenticationError(request.authError.message, request.authError);
    }

    throw createAuthenticationError();
  });

  app.decorateRequest('authUser', null);
  app.decorateRequest('authError', null);
  app.decorateRequest('authorization', null);

  app.addHook('onRequest', async (request) => {
    request.authUser = null;
    request.authError = null;
    setActiveUser(null);

    const token = extractAccessToken(request);
    if (!token) {
      request.authorization = new AuthorizationContext(null, null);
      return;
    }

    try {
      const claims = await tokenVerifier.verify(token);
      const organizations = await hydrateOrganizations(
        request,
        permissionService,
        claims.sub,
        claims.organizations,
      );
      const user: AuthenticatedUser = {
        id: claims.sub,
        email: claims.email,
        globalRoles: new Set(claims.roles),
        tokenId: claims.jti,
        activeContext: claims.activeContext ?? null,
        organizations,
        claims,
      };

      request.authUser = user;
      setActiveUser(user.id);
      request.authorization = new AuthorizationContext(user, null);
    } catch (error) {
      request.authUser = null;
      request.authError = error instanceof Error ? error : new Error('Authentication failed');
      request.authorization = new AuthorizationContext(null, request.authError);
    }
  });
}

async function hydrateOrganizations(
  request: FastifyRequest,
  permissionService: PermissionService,
  userId: string,
  organizationClaims: AccessTokenOrganizationClaim[],
): Promise<Map<string, AuthenticatedOrganization>> {
  const organizations = new Map<string, AuthenticatedOrganization>();

  if (organizationClaims.length === 0) {
    return organizations;
  }

  const permissionPromises = organizationClaims.map((organization) =>
    permissionService
      .getOrganizationPermissions(userId, organization)
      .then((permissionSet): [AccessTokenOrganizationClaim, OrganizationPermissionSet | null] => [
        organization,
        permissionSet,
      ])
      .catch((error): [AccessTokenOrganizationClaim, OrganizationPermissionSet | null] => {
        request.log.warn(
          { err: error, organizationId: organization.id },
          'Failed to hydrate organization permissions',
        );
        return [organization, null];
      }),
  );

  const permissionResults = await Promise.all(permissionPromises);

  for (const [organization, permissionSet] of permissionResults) {
    if (!permissionSet) {
      continue;
    }

    organizations.set(organization.id, {
      organizationId: organization.id,
      roles: new Set(organization.roles ?? []),
      permissions: new Set(permissionSet.permissions),
      roleSlug: permissionSet.roleSlug,
      permissionsVersion: permissionSet.version,
    });
  }

  return organizations;
}

function extractAccessToken(request: FastifyRequest): string | null {
  const header = request.headers[AUTH_HEADER];
  if (!header) {
    return null;
  }

  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized.startsWith(BEARER_PREFIX)) {
    return null;
  }

  return trimmed.slice(BEARER_PREFIX.length).trim();
}

function normalizeRoles(roles?: string | string[] | null): Set<string> | null {
  if (!roles) {
    return null;
  }

  if (Array.isArray(roles)) {
    return new Set(roles);
  }

  return new Set([roles]);
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
    authError: Error | null;
    authorization: AuthorizationContext;
  }

  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
