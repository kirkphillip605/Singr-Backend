import { PermissionService } from './auth/permission-service';
import { TokenVerifier } from './auth/token-verifier';
import { getConfig } from './config';
import { createPrismaClient } from './lib/prisma';
import { createRedisClient } from './lib/redis';
import { initSentry } from './observability/sentry';
import { buildServer } from './server';

export async function bootstrap() {
  const config = getConfig();
  initSentry(config);

  const redis = createRedisClient(config);
  await redis.connect();

  const prisma = createPrismaClient({ config });
  await prisma.$connect();

  const tokenVerifier = new TokenVerifier(config);
  const permissionService = new PermissionService(prisma, redis);

  const app = await buildServer({ config, redis, prisma, tokenVerifier, permissionService });

  await app.listen({ port: config.server.port, host: config.server.host });
  app.log.info({ port: config.server.port }, 'Singr System API listening');

  return app;
}

if (require.main === module) {
  bootstrap()
    .then((app) => {
      const shutdown = async (signal: NodeJS.Signals) => {
        app.log.info({ signal }, 'Received shutdown signal');
        try {
          await app.close();
          process.exit(0);
        } catch (error) {
          app.log.error({ err: error }, 'Error during shutdown');
          process.exit(1);
        }
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to bootstrap Singr System API', error);
      process.exitCode = 1;
    });
}
