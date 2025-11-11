import type { FastifyInstance } from 'fastify';
import type { Registry } from 'prom-client';

import type { AppConfig } from '../config';
import type { RedisClient } from '../lib/redis';

type HealthRouteOptions = {
  config: AppConfig;
  redis: RedisClient;
  metricsRegistry: Registry;
};

export async function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions) {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async () => {
    await options.redis.ping();

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    if (!options.config.metrics.enabled) {
      return reply.code(404).send();
    }

    reply.header('content-type', options.metricsRegistry.contentType);
    const metrics = await options.metricsRegistry.metrics();
    return reply.send(metrics);
  });
}
