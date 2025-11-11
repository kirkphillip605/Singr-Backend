import type { Registry } from 'prom-client';
import { Histogram } from 'prom-client';

export type HttpMetrics = {
  requestDuration: Histogram<string>;
};

export function createHttpMetrics(registry: Registry): HttpMetrics {
  const requestDuration = new Histogram({
    name: 'system_api_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.3, 0.5, 0.75, 1, 2, 5],
    registers: [registry],
  });

  return { requestDuration };
}
