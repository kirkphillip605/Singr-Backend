import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { BrandingService } from '../branding-service';
import type { RedisClient } from '../../lib/redis';

describe('BrandingService', () => {
  const prismaRaw = {
    brandingProfile: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const prismaMock = prismaRaw as unknown as PrismaClient;

  const redisRaw = {
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
  };
  const redisMock = redisRaw as unknown as RedisClient;

  let service: BrandingService;

  beforeEach(() => {
    service = new BrandingService(prismaMock, redisMock, {
      cacheTtlSeconds: 60,
      uploadTtlSeconds: 120,
      storageEndpoint: 'https://storage.test',
      bucket: 'assets',
      signingSecret: 'secret',
    });
    vi.clearAllMocks();
  });

  it('updates branding profile and bumps cache version', async () => {
    prismaRaw.brandingProfile.findFirst.mockResolvedValueOnce({
      id: 'bp_1',
      name: 'Existing',
      logoUrl: null,
      colorPalette: {},
      poweredBySingr: true,
      domain: null,
      appBundleId: null,
      appPackageName: null,
      status: 'active',
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    prismaRaw.brandingProfile.upsert.mockResolvedValueOnce({
      id: 'bp_1',
      name: 'Updated',
      logoUrl: 'https://cdn/logo.png',
      colorPalette: {},
      poweredBySingr: true,
      domain: null,
      appBundleId: null,
      appPackageName: null,
      status: 'active',
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const updated = await service.updateBrandingProfile('cust-1', {
      name: 'Updated',
      logoUrl: 'https://cdn/logo.png',
    });

    expect(updated.name).toBe('Updated');
    expect(redisRaw.incr).toHaveBeenCalledWith('cache:branding:cust-1:version');
  });

  it('creates signed upload descriptor with sanitized key', async () => {
    prismaRaw.brandingProfile.findFirst.mockResolvedValue({
      id: 'bp_1',
      name: 'Branding',
      logoUrl: null,
      colorPalette: {},
      poweredBySingr: true,
      domain: null,
      appBundleId: null,
      appPackageName: null,
      status: 'active',
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const upload = await service.createSignedUpload('cust-1', {
      fileName: ' Logo File .PNG ',
      contentType: 'image/png',
    });

    expect(upload.assetKey).toMatch(/^branding\/cust-1\//);
    expect(upload.uploadUrl).toContain('https://storage.test/assets/');
    expect(upload.headers['content-type']).toBe('image/png');
  });

  it('returns platform branding with signed assets', async () => {
    redisRaw.get.mockImplementation(async (key: string) => {
      if (key === 'cache:branding:platform:version') {
        return '0';
      }

      return null;
    });

    prismaRaw.brandingProfile.findFirst.mockResolvedValueOnce({
      id: 'platform-1',
      name: 'Platform',
      logoUrl: 'branding/platform/logo.png',
      colorPalette: {},
      poweredBySingr: true,
      domain: null,
      appBundleId: null,
      appPackageName: null,
      status: 'active',
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const branding = await service.getPlatformBrandingProfile();
    expect(branding?.id).toBe('platform-1');
    expect(branding?.logoUrl).toMatch(/^https:\/\/storage\.test\/assets\//);
    expect(branding?.logoUrlExpiresAt).toMatch(/Z$/);
    expect(redisRaw.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60);
  });
});
