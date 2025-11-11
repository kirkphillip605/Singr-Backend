import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';

import { PrismaClient } from '@prisma/client';

import type { AppConfig } from '../config';
import { getRequestContext } from '../http/request-context';

const prismaClientStorage = new AsyncLocalStorage<boolean>();

export type PrismaClientFactoryOptions = {
  config: AppConfig;
};

export function createPrismaClient({ config }: PrismaClientFactoryOptions): PrismaClient {
  const logLevels: ('info' | 'query' | 'warn' | 'error')[] = ['warn', 'error'];
  if (config.env === 'development') {
    logLevels.push('info');
  }

  const prisma = new PrismaClient({
    log: logLevels,
  });

  type PrismaMiddlewareParams = {
    model?: string;
    action: string;
    args: unknown;
    dataPath: string[];
    runInTransaction: boolean;
  };
  type PrismaMiddlewareNext = (params: PrismaMiddlewareParams) => Promise<unknown>;

  const auditMiddleware = async (params: PrismaMiddlewareParams, next: PrismaMiddlewareNext) => {
    if (prismaClientStorage.getStore()) {
      return next(params);
    }

    const context = getRequestContext();
    if (!context) {
      return next(params);
    }

    const userId = context.userId ?? '';

    return prismaClientStorage.run(true, async () => {
      await prisma.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return next(params);
    });
  };

  prisma.$use(auditMiddleware as Parameters<typeof prisma.$use>[0]);

  return prisma;
}

export function computePermissionCacheVersion(
  roleSlug: string | null,
  permissions: Iterable<string>,
  updatedAt: Date | string | null,
): string {
  const hash = createHash('sha256');
  hash.update(roleSlug ?? '');

  const normalized = Array.from(new Set(Array.from(permissions))).sort();
  for (const permission of normalized) {
    hash.update('|');
    hash.update(permission);
  }

  if (updatedAt) {
    hash.update('|');
    hash.update(typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString());
  }

  return hash.digest('hex');
}
