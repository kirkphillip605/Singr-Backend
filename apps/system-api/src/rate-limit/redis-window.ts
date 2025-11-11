import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config';
import { HttpError } from '../http/problem';
import type { RedisClient } from '../lib/redis';

type RateLimitOptions = {
  redis: RedisClient;
  config: AppConfig;
  limit?: number;
  windowMs?: number;
  keyGenerator?: (request: FastifyRequest) => string;
};

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;

type SlidingWindowOptions = {
  limit: number;
  windowMs: number;
};

export async function enforceSlidingWindowLimit(
  redis: RedisClient,
  key: string,
  options: SlidingWindowOptions,
) {
  const now = Date.now();
  const windowStart = now - options.windowMs;
  const redisKey = `ratelimit:${key}`;

  const results = await redis
    .multi()
    .zremrangebyscore(redisKey, 0, windowStart)
    .zadd(redisKey, now, `${now}:${Math.random()}`)
    .zcard(redisKey)
    .pexpire(redisKey, options.windowMs)
    .exec();

  if (!results) {
    throw new HttpError({
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limiter unavailable.',
    });
  }

  const currentCountRaw = results[2]?.[1];
  const currentCount =
    typeof currentCountRaw === 'number' ? currentCountRaw : Number(currentCountRaw ?? 0);

  if (currentCount > options.limit) {
    throw new HttpError(
      {
        title: 'Too Many Requests',
        status: 429,
        detail: 'Rate limit exceeded.',
      },
      { cause: { key, currentCount } },
    );
  }

  return {
    remaining: Math.max(options.limit - currentCount, 0),
    reset: Math.ceil((windowStart + options.windowMs) / 1000),
    limit: options.limit,
  };
}

export function registerRateLimitPlugin(app: FastifyInstance, options: RateLimitOptions) {
  const limit = options.limit ?? options.config.rateLimit.defaultMax ?? DEFAULT_LIMIT;
  const windowMs =
    options.windowMs ?? options.config.rateLimit.defaultWindowMs ?? DEFAULT_WINDOW_MS;
  const keyGenerator =
    options.keyGenerator ?? defaultKeyGenerator(options.config.rateLimit.trustProxy);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = keyGenerator(request);
    const result = await enforceSlidingWindowLimit(options.redis, key, { limit, windowMs });

    reply.header('x-ratelimit-limit', result.limit);
    reply.header('x-ratelimit-remaining', result.remaining);
    reply.header('x-ratelimit-reset', result.reset);
  });
}

function defaultKeyGenerator(trustProxy: boolean) {
  return (request: FastifyRequest) => {
    if (trustProxy) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        return forwarded.split(',')[0]!.trim();
      }
    }

    return request.ip;
  };
}
