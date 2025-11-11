import { z } from 'zod';

export const accessTokenOrganizationClaimSchema = z.object({
  id: z.string().uuid(),
  roles: z.array(z.string()).default([]),
  permissionsHash: z.string().min(1).optional(),
});

export const accessTokenActiveContextSchema = z.object({
  type: z.enum(['customer', 'singer']),
  id: z.string().uuid(),
});

export const accessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  aud: z.union([z.string(), z.array(z.string())]),
  iss: z.string().optional(),
  exp: z.number(),
  iat: z.number(),
  jti: z.string(),
  roles: z.array(z.string()).default([]),
  organizations: z.array(accessTokenOrganizationClaimSchema).default([]),
  activeContext: accessTokenActiveContextSchema.nullish(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
export type AccessTokenOrganizationClaim = z.infer<typeof accessTokenOrganizationClaimSchema>;
export type AccessTokenActiveContext = z.infer<typeof accessTokenActiveContextSchema>;

export type AuthenticatedOrganization = {
  organizationId: string;
  roles: Set<string>;
  permissions: Set<string>;
  roleSlug: string | null;
  permissionsVersion: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  globalRoles: Set<string>;
  tokenId: string;
  activeContext: AccessTokenActiveContext | null;
  organizations: Map<string, AuthenticatedOrganization>;
  claims: AccessTokenClaims;
};
