import cors from '@fastify/cors';
import type { FastifyCorsOptions } from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance, FastifyServerOptions } from 'fastify';
import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';

import type { PrismaClient } from '@prisma/client';

import { registerAuthenticationPlugin } from './auth/plugin';
import type { AuthService } from './auth/auth-service';
import type { PermissionService } from './auth/permission-service';
import type { TokenVerifier } from './auth/token-verifier';
import type { AppConfig } from './config';
import { registerErrorHandlers } from './http/error-handler';
import { registerRequestContextPlugin } from './http/request-context';
import type { AppLogger } from './lib/logger';
import { createHttpMetrics } from './metrics/http';
import { createMetricsRegistry } from './metrics/registry';
import { registerSentryRequestInstrumentation } from './observability/sentry';
import { registerRateLimitPlugin } from './rate-limit/redis-window';
import { registerHealthRoutes } from './routes/health';
import { registerAuthRoutes } from './routes/auth';
import { registerCustomerVenueRoutes } from './routes/customer/venues';
import { registerCustomerSystemRoutes } from './routes/customer/systems';
import { registerCustomerApiKeyRoutes } from './routes/customer/api-keys';
import { registerCustomerSubscriptionRoutes } from './routes/customer/subscriptions';
import { registerCustomerBrandingRoutes } from './routes/customer/branding';
import { registerCustomerOrganizationUserRoutes } from './routes/customer/organization-users';
import { registerCustomerSongdbRoutes } from './routes/customer/songdb';
import { registerSingerRoutes } from './routes/singer';
import { registerAdminRoutes } from './routes/admin';
import type { RedisClient } from './lib/redis';
import type { VenueService } from './customer/venue-service';
import type { SystemService } from './customer/system-service';
import type { ApiKeyService } from './customer/api-key-service';
import type { SubscriptionService } from './customer/subscription-service';
import type { BrandingService } from './customer/branding-service';
import type { OrganizationUserService } from './customer/organization-user-service';
import type { SongdbIngestionService } from './customer/songdb-ingestion-service';
import type { QueueProducerSet } from './queues/producers';
import type { SingerProfileService } from './singer/profile-service';
import type { SingerRequestService } from './singer/request-service';
import type { SingerFavoritesService } from './singer/favorites-service';
import type { SingerHistoryService } from './singer/history-service';
import type { AdminUserService } from './admin/user-service';
import type { AdminOrganizationService } from './admin/organization-service';
import type { AdminRoleService } from './admin/role-service';
import type { AdminBrandingOversightService } from './admin/branding-oversight-service';
import type { AdminStripeWebhookService } from './admin/stripe-webhook-service';

declare module 'fastify' {
  interface FastifyRequest {
    metricsStartTime?: [number, number];
  }
}

export type BuildServerOptions = {
  config: AppConfig;
  redis: RedisClient;
  prisma: PrismaClient;
  tokenVerifier: TokenVerifier;
  permissionService: PermissionService;
  authService: AuthService;
  venueService: VenueService;
  systemService: SystemService;
  apiKeyService: ApiKeyService;
  subscriptionService: SubscriptionService;
  brandingService: BrandingService;
  organizationUserService: OrganizationUserService;
  songdbService: SongdbIngestionService;
  queueProducers: QueueProducerSet;
  singerProfileService: SingerProfileService;
  singerRequestService: SingerRequestService;
  singerFavoritesService: SingerFavoritesService;
  singerHistoryService: SingerHistoryService;
  adminUserService: AdminUserService;
  adminOrganizationService: AdminOrganizationService;
  adminRoleService: AdminRoleService;
  adminBrandingService: AdminBrandingOversightService;
  adminStripeService: AdminStripeWebhookService;
  logger: AppLogger;
};

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const {
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
    adminUserService,
    adminOrganizationService,
    adminRoleService,
    adminBrandingService,
    adminStripeService,
    logger,
  } = options;

  const metricsRegistry = createMetricsRegistry(config);
  const httpMetrics = createHttpMetrics(metricsRegistry);

  const serverOptions: FastifyServerOptions = {
    logger: logger as unknown as FastifyBaseLogger,
    trustProxy: config.rateLimit.trustProxy,
    genReqId: (req: IncomingMessage) => {
      const headerId = Array.isArray(req.headers['x-request-id'])
        ? req.headers['x-request-id'][0]
        : req.headers['x-request-id'];
      return headerId ?? randomUUID();
    },
  };

  const app = Fastify(serverOptions);

  registerSentryRequestInstrumentation(app);
  registerRequestContextPlugin(app);
  registerRateLimitPlugin(app, { config, redis });
  await registerAuthenticationPlugin(app, { config, tokenVerifier, permissionService });

  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: createCorsOriginValidator(config),
    credentials: true,
  });

  app.addHook('onRequest', async (request) => {
    request.metricsStartTime = process.hrtime();
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.metricsStartTime) {
      return;
    }

    const diff = process.hrtime(request.metricsStartTime);
    const durationSeconds = diff[0] + diff[1] / 1_000_000_000;
    const route = request.routerPath ?? request.url;

    httpMetrics.requestDuration.observe(
      {
        method: request.method,
        route,
        status_code: reply.statusCode.toString(),
      },
      durationSeconds,
    );
  });

  await registerHealthRoutes(app, { config, redis, metricsRegistry });
  await registerAuthRoutes(app, { config, redis, authService });
  await registerCustomerVenueRoutes(app, { config, venueService });
  await registerCustomerSystemRoutes(app, { config, systemService });
  await registerCustomerApiKeyRoutes(app, { config, apiKeyService });
  await registerCustomerSubscriptionRoutes(app, { config, subscriptionService });
  await registerCustomerBrandingRoutes(app, { config, brandingService });
  await registerCustomerOrganizationUserRoutes(app, {
    config,
    organizationUserService,
  });
  await registerCustomerSongdbRoutes(app, { config, songdbService });
  await registerSingerRoutes(app, {
    profileService: singerProfileService,
    requestService: singerRequestService,
    favoritesService: singerFavoritesService,
    historyService: singerHistoryService,
  });
  await registerAdminRoutes(app, {
    userService: adminUserService,
    organizationService: adminOrganizationService,
    roleService: adminRoleService,
    brandingService: adminBrandingService,
    stripeService: adminStripeService,
    metricsRegistry,
  });

  registerErrorHandlers(app);

  app.decorate('config', config);
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await redis.quit();
    await prisma.$disconnect();
    await queueProducers.close();
  });

  return app;
}

function createCorsOriginValidator(config: AppConfig) {
  const allowedOrigins = config.cors.origins;
  if (allowedOrigins.length === 0) {
    return false;
  }

  return ((origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }

    cb(new Error('Origin not allowed'), false);
  }) as FastifyCorsOptions['origin'];
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
  }
}
