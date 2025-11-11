import type { BrandingProfile, BrandingStatus, Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError } from '../http/problem';

export type AdminBrandingProfileDto = {
  id: string;
  ownerType: string;
  ownerId: string | null;
  name: string;
  logoUrl: string | null;
  colorPalette: Record<string, unknown>;
  poweredBySingr: boolean;
  domain: string | null;
  appBundleId: string | null;
  appPackageName: string | null;
  status: BrandingStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpdateBrandingStatusInput = {
  status?: BrandingStatus;
  metadata?: Record<string, unknown>;
};

export class AdminBrandingOversightService {
  constructor(private readonly prisma: PrismaClient) {}

  async listBrandingProfiles(): Promise<AdminBrandingProfileDto[]> {
    const profiles = await this.prisma.brandingProfile.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return profiles.map((profile) => this.mapProfile(profile));
  }

  async updateBrandingProfile(
    brandingProfileId: string,
    input: UpdateBrandingStatusInput,
  ): Promise<AdminBrandingProfileDto> {
    const data: Prisma.BrandingProfileUpdateInput = {};

    if (input.status !== undefined) {
      data.status = input.status;
    }

    if (input.metadata !== undefined) {
      data.metadata = input.metadata as Prisma.InputJsonValue;
    }

    try {
      const updated = await this.prisma.brandingProfile.update({
        where: { id: brandingProfileId },
        data,
      });

      return this.mapProfile(updated);
    } catch (error) {
      throw createNotFoundError('Branding profile', { brandingProfileId }, error);
    }
  }

  private mapProfile(profile: BrandingProfile): AdminBrandingProfileDto {
    return {
      id: profile.id,
      ownerType: profile.ownerType,
      ownerId: profile.ownerId ?? null,
      name: profile.name,
      logoUrl: profile.logoUrl ?? null,
      colorPalette: normalizeJson(profile.colorPalette),
      poweredBySingr: profile.poweredBySingr,
      domain: profile.domain ?? null,
      appBundleId: profile.appBundleId ?? null,
      appPackageName: profile.appPackageName ?? null,
      status: profile.status,
      metadata: normalizeJson(profile.metadata),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}

function normalizeJson(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
