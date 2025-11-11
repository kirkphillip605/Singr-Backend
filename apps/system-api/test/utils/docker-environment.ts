import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { GenericContainer, StartedTestContainer } from 'testcontainers';

export type DockerEnvironment = {
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
};

export const shouldRunDockerTests = process.env.RUN_DOCKER_TESTS === 'true';

export async function startDockerEnvironment(): Promise<DockerEnvironment> {
  const postgres = await new GenericContainer('postgis/postgis:15-3.4')
    .withEnvironment({
      POSTGRES_USER: 'singr',
      POSTGRES_PASSWORD: 'singr',
      POSTGRES_DB: 'singr',
    })
    .withExposedPorts(5432)
    .start();

  const redis = await new GenericContainer('redis:7-alpine')
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
    .withExposedPorts(6379)
    .start();

  const postgresPort = postgres.getMappedPort(5432);
  const redisPort = redis.getMappedPort(6379);
  const host = postgres.getHost();

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `postgresql://singr:singr@${host}:${postgresPort}/singr`;
  process.env.REDIS_URL = `redis://${host}:${redisPort}/0`;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'integration-secret';
  process.env.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY ?? 'integration-private-key';
  process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY ?? 'integration-public-key';
  process.env.SENTRY_DSN = '';
  process.env.SENTRY_RELEASE = process.env.SENTRY_RELEASE ?? 'integration-test';

  await migrateDatabase();

  return { postgres, redis };
}

export async function stopDockerEnvironment(env: DockerEnvironment | null | undefined) {
  if (!env) {
    return;
  }

  await Promise.allSettled([env.redis.stop(), env.postgres.stop()]);
}

async function migrateDatabase() {
  const prismaDir = path.resolve(__dirname, '../../');
  const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: prismaDir,
    env: { ...process.env },
    stdio: 'inherit',
  });

  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) {
    throw new Error(`Failed to run prisma migrate deploy (exit code ${code})`);
  }
}
