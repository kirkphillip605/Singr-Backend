import { AuthService } from './auth/auth-service';
import { PermissionService } from './auth/permission-service';
import { RefreshTokenStore } from './auth/refresh-token-store';
import { TokenService } from './auth/token-service';
import { TokenVerifier } from './auth/token-verifier';
import Stripe from 'stripe';

import { SystemService } from './customer/system-service';
import { VenueService } from './customer/venue-service';
import { ApiKeyService } from './customer/api-key-service';
import { SubscriptionService } from './customer/subscription-service';
import { BrandingService } from './customer/branding-service';
import { OrganizationUserService } from './customer/organization-user-service';
import { SongdbIngestionService } from './customer/songdb-ingestion-service';
import { getConfig } from './config';
import { createPrismaClient } from './lib/prisma';
import { createRedisClient } from './lib/redis';
import { initSentry } from './observability/sentry';
import { buildServer } from './server';
import { createQueueProducers } from './queues/producers';
import { createLogger } from './lib/logger';
import { SingerProfileService } from './singer/profile-service';
import { SingerFavoritesService } from './singer/favorites-service';
import { SingerHistoryService } from './singer/history-service';
import { SingerRequestService } from './singer/request-service';

export async function bootstrap() {
  const config = getConfig();
  initSentry(config);

  const redis = createRedisClient(config);
  await redis.connect();

  const prisma = createPrismaClient({ config });
  await prisma.$connect();

  const queueProducers = createQueueProducers(redis);
  const logger = createLogger(config);

  const stripe = config.stripe.apiKey
    ? new Stripe(config.stripe.apiKey, { apiVersion: '2024-04-10' as const })
    : null;

  const tokenVerifier = new TokenVerifier(config);
  const permissionService = new PermissionService(prisma, redis);
  const refreshTokenStore = new RefreshTokenStore(redis, config.auth.refreshTokenTtlSeconds);
  const tokenService = new TokenService({
    config,
    prisma,
    permissionService,
    refreshTokenStore,
  });
  const authService = new AuthService({ prisma, tokenService, permissionService });
  const venueService = new VenueService(prisma, redis, {
    cacheTtlSeconds: config.cache.venueListTtlSeconds,
  });
  const systemService = new SystemService(prisma, redis, {
    cacheTtlSeconds: config.cache.systemListTtlSeconds,
  });
  const apiKeyService = new ApiKeyService(prisma, redis, {
    cacheTtlSeconds: config.cache.apiKeyListTtlSeconds,
  });
  const subscriptionService = new SubscriptionService(
    prisma,
    redis,
    stripe,
    queueProducers.stripeWebhookProducer,
    {
      cacheTtlSeconds: config.cache.subscriptionListTtlSeconds,
    },
  );
  const brandingService = new BrandingService(prisma, redis, {
    cacheTtlSeconds: config.cache.brandingProfileTtlSeconds,
    uploadTtlSeconds: config.branding.uploadUrlTtlSeconds,
    storageEndpoint: config.storage.endpoint,
    bucket: config.storage.bucket,
    signingSecret: config.storage.secretAccessKey,
  });
  const organizationUserService = new OrganizationUserService(
    prisma,
    redis,
    queueProducers.invitationProducer,
    {
      cacheTtlSeconds: config.cache.organizationUserListTtlSeconds,
      invitationTtlSeconds: config.organization.invitationTtlSeconds,
    },
  );
  const songdbService = new SongdbIngestionService(prisma, redis, queueProducers.songIndexProducer, {
    cacheTtlSeconds: config.cache.songdbIngestTtlSeconds,
  });
  const singerProfileService = new SingerProfileService(prisma, redis, {
    cacheTtlSeconds: config.cache.singerProfileTtlSeconds,
  });
  const singerFavoritesService = new SingerFavoritesService(prisma, redis, {
    cacheTtlSeconds: config.cache.singerFavoritesTtlSeconds,
  });
  const singerHistoryService = new SingerHistoryService(prisma, redis, {
    cacheTtlSeconds: config.cache.singerHistoryTtlSeconds,
  });
  const singerRequestService = new SingerRequestService(
    prisma,
    redis,
    singerHistoryService,
    queueProducers.singerRequestProducer,
    logger,
    {
      perSingerLimit: config.singer.requestLimitPerSinger,
      perSingerWindowMs: config.singer.requestWindowMsPerSinger,
      perVenueLimit: config.singer.requestLimitPerVenue,
      perVenueWindowMs: config.singer.requestWindowMsPerVenue,
    },
  );

  const app = await buildServer({
    config,
    redis,
    prisma,
    tokenVerifier,
    permissionService,
    authService,
    venueService,
    systemService,
    apiKeyService,
    subscriptionService,
    brandingService,
    organizationUserService,
    songdbService,
    queueProducers,
    singerProfileService,
    singerRequestService,
    singerFavoritesService,
    singerHistoryService,
    logger,
  });

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
