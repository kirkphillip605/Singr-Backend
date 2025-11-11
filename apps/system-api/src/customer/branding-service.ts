import { createHmac, randomUUID } from 'crypto';

import { BrandingOwnerType, Prisma, type PrismaClient } from '@prisma/client';

import { createNotFoundError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

const CUSTOMER_OWNER_TYPE =
  (BrandingOwnerType as unknown as { customer?: BrandingOwnerType })?.customer ??
  ('customer' as unknown as BrandingOwnerType);

export type BrandingProfileDto = {
  id: string;
  customerProfileId: string;
  name: string;
  logoUrl: string | null;
  colorPalette: Record<string, unknown>;
  poweredBySingr: boolean;
  domain: string | null;
  appBundleId: string | null;
  appPackageName: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpdateBrandingProfileInput = {
  name?: string;
  logoUrl?: string | null;
  colorPalette?: Record<string, unknown>;
  poweredBySingr?: boolean;
  domain?: string | null;
  appBundleId?: string | null;
  appPackageName?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateSignedUploadInput = {
  fileName: string;
  contentType: string;
};

export type SignedUploadDescriptor = {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  assetKey: string;
};

type BrandingServiceOptions = {
  cacheTtlSeconds?: number;
  uploadTtlSeconds?: number;
  storageEndpoint: string;
  bucket: string;
  signingSecret: string;
};

export class BrandingService {
  private readonly cacheTtlSeconds: number;
  private readonly uploadTtlSeconds: number;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly signingSecret: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClient,
    options: BrandingServiceOptions,
  ) {
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this.uploadTtlSeconds = options.uploadTtlSeconds ?? 900;
    this.endpoint = options.storageEndpoint.replace(/\/$/, '');
    this.bucket = options.bucket;
    this.signingSecret = options.signingSecret;
  }

  async getBrandingProfile(customerProfileId: string): Promise<BrandingProfileDto | null> {
    const version = await this.getCacheVersion(customerProfileId);
    const cacheKey = this.buildCacheKey(customerProfileId, version);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as BrandingProfileDto;
    }

    const profile = await this.prisma.brandingProfile.findFirst({
      where: {
        ownerType: CUSTOMER_OWNER_TYPE,
        ownerId: customerProfileId,
      },
      select: brandingSelect,
    });

    if (!profile) {
      return null;
    }

    const dto = this.mapModelToDto(profile, customerProfileId);
    await this.redis.set(cacheKey, JSON.stringify(dto), 'EX', this.cacheTtlSeconds);
    return dto;
  }

  async updateBrandingProfile(
    customerProfileId: string,
    input: UpdateBrandingProfileInput,
  ): Promise<BrandingProfileDto> {
    const existing = await this.prisma.brandingProfile.findFirst({
      where: {
        ownerType: CUSTOMER_OWNER_TYPE,
        ownerId: customerProfileId,
      },
      select: brandingSelect,
    });

    const data: Prisma.BrandingProfileUpsertArgs['create'] = {
      ownerType: CUSTOMER_OWNER_TYPE,
      ownerId: customerProfileId,
      name: input.name?.trim() || existing?.name || 'Customer Branding',
      logoUrl: input.logoUrl ?? existing?.logoUrl ?? null,
      colorPalette: (input.colorPalette ?? (existing?.colorPalette as Prisma.InputJsonValue) ?? {}) as Prisma.InputJsonValue,
      poweredBySingr: input.poweredBySingr ?? existing?.poweredBySingr ?? true,
      domain: input.domain ?? existing?.domain ?? null,
      appBundleId: input.appBundleId ?? existing?.appBundleId ?? null,
      appPackageName: input.appPackageName ?? existing?.appPackageName ?? null,
      metadata: (input.metadata ?? (existing?.metadata as Prisma.InputJsonValue) ?? {}) as Prisma.InputJsonValue,
    };

    const updated = await this.prisma.brandingProfile.upsert({
      where: existing
        ? { id: existing.id }
        : {
            ownerType_ownerId_name: {
              ownerType: CUSTOMER_OWNER_TYPE,
              ownerId: customerProfileId,
              name: data.name,
            },
          },
      create: data,
      update: {
        name: data.name,
        logoUrl: data.logoUrl,
        colorPalette: data.colorPalette,
        poweredBySingr: data.poweredBySingr,
        domain: data.domain,
        appBundleId: data.appBundleId,
        appPackageName: data.appPackageName,
        metadata: data.metadata,
      },
      select: brandingSelect,
    });

    await this.bumpCacheVersion(customerProfileId);

    return this.mapModelToDto(updated, customerProfileId);
  }

  async requireBrandingProfile(customerProfileId: string): Promise<BrandingProfileDto> {
    const branding = await this.getBrandingProfile(customerProfileId);
    if (!branding) {
      throw createNotFoundError('Branding profile', { customerProfileId });
    }

    return branding;
  }

  async createSignedUpload(
    customerProfileId: string,
    input: CreateSignedUploadInput,
  ): Promise<SignedUploadDescriptor> {
    const branding = await this.requireBrandingProfile(customerProfileId);

    const sanitizedName = sanitizeFileName(input.fileName);
    const assetKey = `branding/${customerProfileId}/${randomUUID()}-${sanitizedName}`;
    const expiresAt = new Date(Date.now() + this.uploadTtlSeconds * 1000);
    const signaturePayload = `${assetKey}:${input.contentType}:${expiresAt.getTime()}`;
    const signature = createHmac('sha256', this.signingSecret).update(signaturePayload).digest('hex');

    const uploadUrl = `${this.endpoint}/${this.bucket}/${assetKey}?signature=${signature}&expires=${expiresAt.getTime()}`;

    return {
      uploadUrl,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'x-branding-profile-id': branding.id,
      },
      expiresAt: expiresAt.toISOString(),
      assetKey,
    };
  }

  private mapModelToDto(model: Prisma.BrandingProfileGetPayload<{ select: typeof brandingSelect }>, customerProfileId: string): BrandingProfileDto {
    return {
      id: model.id,
      customerProfileId,
      name: model.name,
      logoUrl: model.logoUrl ?? null,
      colorPalette: normalizeJson(model.colorPalette),
      poweredBySingr: model.poweredBySingr,
      domain: model.domain ?? null,
      appBundleId: model.appBundleId ?? null,
      appPackageName: model.appPackageName ?? null,
      status: model.status,
      metadata: normalizeJson(model.metadata),
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  private buildCacheKey(customerProfileId: string, version: number): string {
    return `cache:branding:${customerProfileId}:v${version}`;
  }

  private getCacheVersionKey(customerProfileId: string): string {
    return `cache:branding:${customerProfileId}:version`;
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

const brandingSelect = {
  id: true,
  name: true,
  logoUrl: true,
  colorPalette: true,
  poweredBySingr: true,
  domain: true,
  appBundleId: true,
  appPackageName: true,
  status: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BrandingProfileSelect;

function normalizeJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase() || 'asset';
}
