import http from 'k6/http';
import { Trend, Rate } from 'k6/metrics';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    api_smoke: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: 50, duration: '2m' },
        { target: 75, duration: '2m' },
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const readinessLatency = new Trend('readyz_latency');
const readyzFailures = new Rate('readyz_failures');

export default function run() {
  const baseUrl = __ENV.SYSTEM_API_BASE_URL ?? 'http://localhost:3000';
  const response = http.get(`${baseUrl}/readyz`);
  readinessLatency.add(response.timings.duration);

  const isHealthy = check(response, {
    'status is 200': (res) => res.status === 200,
    'ready payload matches contract': (res) => {
      try {
        const payload = res.json();
        return payload.status === 'ready' && typeof payload.timestamp === 'string';
      } catch (error) {
        return false;
      }
    },
  });

  if (!isHealthy) {
    readyzFailures.add(1);
  } else {
    readyzFailures.add(0);
  }

  sleep(1);
}
