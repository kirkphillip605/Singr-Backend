# Monitoring the Singr System API

The System API publishes Prometheus metrics and health endpoints suitable for dashboards and alerting.

## Key endpoints

| Endpoint | Description |
| --- | --- |
| `GET /healthz` | Lightweight liveness check. Returns `{ status: 'ok', uptime }`. |
| `GET /readyz` | Probes Redis connectivity; returns `status: 'ready'` only when Redis responds. |
| `GET /metrics` | Exposes Prometheus metrics when `METRICS_ENABLED=true`. |

See `apps/system-api/src/routes/health.ts` for the handlers.

## Prometheus metrics

Metrics are registered in `apps/system-api/src/metrics/registry.ts` and `apps/system-api/src/metrics/http.ts`.

- `system_api_http_request_duration_seconds` (`Histogram`): request latency labeled by `method`, `route`, and `status_code`.
- Default process metrics (CPU, memory, GC) prefixed with `system_api_` when metrics are enabled.

Scrape `/metrics` with the same authentication context you use for health checks. The Helm chart exposes the port `3000` via the `ClusterIP` service named `<release>-system-api`.

## Suggested dashboards

1. **API latency heatmap**: graph the `system_api_http_request_duration_seconds_bucket` series per route to watch for regressions.
2. **Error rate**: sum `system_api_http_request_duration_seconds_count` where `status_code` >= 500 to track server failures.
3. **Queue depth**: add panels that query BullMQ metrics (either via custom exporters or `queue.getJobCounts()` exposed through a cron job) for the queues listed in `docs/runbooks/queue-operations.md`.
4. **Worker heartbeat**: alert if the worker deployment has zero ready replicas for more than 5 minutes.

## Alerting considerations

- Alert on sustained `GET /readyz` failures — they usually indicate Redis outages.
- Alert on missing `/metrics` scrapes; the handler returns 404 when metrics are disabled, so ensure the environment runs with `METRICS_ENABLED=true`.
- Track Sentry ingestion by counting events per environment to catch silent failures in error reporting.
