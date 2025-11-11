import Redis from 'ioredis';

import type { AppConfig } from '../config';

export type RedisClient = Redis;

export function createRedisClient(config: AppConfig): RedisClient {
  const client = new Redis(config.redis.url, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  client.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('Redis connection error', error);
  });

  return client;
}
