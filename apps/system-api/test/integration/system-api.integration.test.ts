import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { bootstrap } from '../../src/main';
import { resetConfigCache } from '../../src/config';
import type { FastifyInstance } from 'fastify';
import { shouldRunDockerTests, startDockerEnvironment, stopDockerEnvironment } from '../utils/docker-environment';
import type { DockerEnvironment } from '../utils/docker-environment';

const healthContract = z.object({
  status: z.literal('ok'),
  uptime: z.number().positive(),
});

const readinessContract = z.object({
  status: z.literal('ready'),
  timestamp: z.string().transform((value, ctx) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'timestamp must be ISO date' });
    }
    return value;
  }),
});

describe.skipIf(!shouldRunDockerTests)('System API integration with dockerized dependencies', () => {
  let env: DockerEnvironment | null = null;
  let app: FastifyInstance | null = null;

  beforeAll(async () => {
    env = await startDockerEnvironment();
    resetConfigCache();
    app = await bootstrap();
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
      app = null;
    }

    await stopDockerEnvironment(env);
  });

  it('serves liveness health check', async () => {
    const response = await request(app!.server).get('/healthz');

    expect(response.status).toBe(200);
    const parsed = healthContract.safeParse(response.body);
    expect(parsed.success).toBe(true);
  });

  it('serves readiness health check', async () => {
    const response = await request(app!.server).get('/readyz');

    expect(response.status).toBe(200);
    const parsed = readinessContract.safeParse(response.body);
    expect(parsed.success).toBe(true);
  });

  it('exposes Prometheus metrics when enabled', async () => {
    const response = await request(app!.server).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('http_request_duration_seconds');
  });
});
