import { collectDefaultMetrics, Registry } from 'prom-client';

import type { AppConfig } from '../config';

export function createMetricsRegistry(config: AppConfig): Registry {
  const registry = new Registry();

  if (config.metrics.enabled) {
    collectDefaultMetrics({
      register: registry,
      prefix: 'system_api_',
    });
  }

  return registry;
}
