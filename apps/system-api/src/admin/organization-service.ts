import type { CustomerProfile, Prisma, PrismaClient } from '@prisma/client';

import { createNotFoundError } from '../http/problem';

export type AdminOrganizationDto = {
  id: string;
  userId: string;
  legalBusinessName: string | null;
  dbaName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpdateAdminOrganizationInput = {
  legalBusinessName?: string | null;
  dbaName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown>;
};

export class AdminOrganizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async listOrganizations(): Promise<AdminOrganizationDto[]> {
    const organizations = await this.prisma.customerProfile.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return organizations.map((organization) => this.mapOrganization(organization));
  }

  async updateOrganization(
    organizationId: string,
    input: UpdateAdminOrganizationInput,
  ): Promise<AdminOrganizationDto> {
    const data: Prisma.CustomerProfileUpdateInput = {};

    if (input.legalBusinessName !== undefined) {
      data.legalBusinessName = input.legalBusinessName;
    }

    if (input.dbaName !== undefined) {
      data.dbaName = input.dbaName;
    }

    if (input.contactEmail !== undefined) {
      data.contactEmail = input.contactEmail;
    }

    if (input.contactPhone !== undefined) {
      data.contactPhone = input.contactPhone;
    }

    if (input.timezone !== undefined) {
      data.timezone = input.timezone;
    }

    if (input.metadata !== undefined) {
      data.metadata = input.metadata as Prisma.InputJsonValue;
    }

    try {
      const updated = await this.prisma.customerProfile.update({
        where: { id: organizationId },
        data,
      });

      return this.mapOrganization(updated);
    } catch (error) {
      throw createNotFoundError('Organization', { organizationId }, error);
    }
  }

  private mapOrganization(organization: CustomerProfile): AdminOrganizationDto {
    return {
      id: organization.id,
      userId: organization.userId,
      legalBusinessName: organization.legalBusinessName ?? null,
      dbaName: organization.dbaName ?? null,
      contactEmail: organization.contactEmail ?? null,
      contactPhone: organization.contactPhone ?? null,
      timezone: organization.timezone ?? null,
      metadata: normalizeJson(organization.metadata),
      createdAt: organization.createdAt.toISOString(),
      updatedAt: organization.updatedAt.toISOString(),
    };
  }
}

function normalizeJson(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
