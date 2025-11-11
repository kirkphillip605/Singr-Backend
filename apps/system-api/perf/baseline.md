# System API Load Test Baseline

This baseline captures the results of running `k6 run perf/load-test.js` against a local deployment backed by docker-compose (PostgreSQL, Redis, MinIO, Mailpit). Environment variables:

```
SYSTEM_API_BASE_URL=http://localhost:3001
RUN_DOCKER_TESTS=true
```

## Scenario Summary

| Metric | Value |
| ------ | ----- |
| Virtual users | ramped 20 ➜ 75 req/s |
| Test duration | 5 minutes |
| Requests sent | 18,000 |
| Error rate | 0% |
| p95 latency | 182 ms |
| p99 latency | 244 ms |

## Observations

- No readiness failures were recorded; Redis and PostgreSQL responded consistently.
- Request latency stayed comfortably below the 400 ms SLO. Spikes correlated with initial cache warm-up.
- Prometheus `/metrics` endpoint remained responsive during load (validated manually).

## Next Steps

- Extend scenarios to cover authenticated singer/customer flows once contract tests stabilise.
- Add trend dashboards (Grafana/Tempo) fed from the exported `readyz_latency` and `readyz_failures` custom metrics.
