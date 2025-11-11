import { Prisma } from '@prisma/client';

export function serializeForAudit(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
