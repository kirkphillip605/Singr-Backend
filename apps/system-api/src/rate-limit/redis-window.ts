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

export function registerRateLimitPlugin(app: FastifyInstance, options: RateLimitOptions) {
  const limit = options.limit ?? options.config.rateLimit.defaultMax ?? DEFAULT_LIMIT;
  const windowMs =
    options.windowMs ?? options.config.rateLimit.defaultWindowMs ?? DEFAULT_WINDOW_MS;
  const keyGenerator =
    options.keyGenerator ?? defaultKeyGenerator(options.config.rateLimit.trustProxy);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = keyGenerator(request);
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `ratelimit:${key}`;

    const results = await options.redis
      .multi()
      .zremrangebyscore(redisKey, 0, windowStart)
      .zadd(redisKey, now, `${now}:${Math.random()}`)
      .zcard(redisKey)
      .pexpire(redisKey, windowMs)
      .exec();

    if (!results) {
      throw new HttpError({
        title: 'Too Many Requests',
        status: 429,
        detail: 'Rate limiter unavailable.',
      });
    }

    const removedRaw = results[0]?.[1];
    const currentCountRaw = results[2]?.[1];

    const removedCount = typeof removedRaw === 'number' ? removedRaw : Number(removedRaw ?? 0);
    const currentCount =
      typeof currentCountRaw === 'number' ? currentCountRaw : Number(currentCountRaw ?? 0);

    reply.header('x-ratelimit-limit', limit);
    reply.header('x-ratelimit-remaining', Math.max(limit - currentCount, 0));
    reply.header('x-ratelimit-reset', Math.ceil((windowStart + windowMs) / 1000));

    if (currentCount > limit) {
      throw new HttpError(
        {
          title: 'Too Many Requests',
          status: 429,
          detail: 'Rate limit exceeded.',
        },
        { cause: { key, removed: removedCount, currentCount } },
      );
    }
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
