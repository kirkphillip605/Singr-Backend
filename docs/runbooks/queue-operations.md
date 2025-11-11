# Queue operations runbook

Singr uses BullMQ queues backed by Redis for asynchronous workloads. The queue topology is defined in `apps/system-api/src/queues/producers.ts` and mirrors the job processors in `apps/system-api/src/worker`. This runbook documents how to inspect, drain, and requeue jobs safely.

## Queue inventory

| Queue name | Purpose | Producer | Worker entry |
| --- | --- | --- | --- |
| `customer-organization-invitations` | Sends organization invitation emails and tracks retries. | `InvitationProducer.enqueueInvitation` | `worker/processors/email.ts` |
| `stripe-webhooks` | Processes Stripe checkout + subscription syncs. | `StripeWebhookProducer.enqueueCheckoutSync`/`enqueueSubscriptionSync` | `worker/processors/stripe.ts` |
| `songdb-index-refresh` | Refreshes cached OpenKJ song data. | `SongIndexProducer.enqueueRefresh` | `worker/processors/song-index.ts` |
| `singer-request-notifications` | Dispatches notifications for singer song requests. | `SingerRequestNotificationProducer.enqueueRequestNotification` | `worker/processors/email.ts` |
| `system-maintenance` | Periodic maintenance tasks such as expiring invitations. | `CleanupProducer.enqueue` | `worker/processors/cleanup.ts` |
| `branding-scan` | Validates uploaded branding assets. | `BrandingScanProducer.enqueue` | `worker/processors/branding.ts` |

Queue names are prefixed with `bull` by default (see `createQueueProducers`), so plan unique Redis instances per environment to avoid collisions.

## Inspecting job health

1. Port-forward Redis or connect via a bastion host.
2. Use `npx bullmq` within the API image (`docker run --rm -it <image> npx bullmq`) or a local Node REPL to query queues:
   ```ts
   import { Queue } from 'bullmq';
   const queue = new Queue('system-maintenance', { connection: { url: process.env.REDIS_URL! } });
   const counts = await queue.getJobCounts();
   console.log(counts);
   ```
3. Compare blocked jobs against expected concurrency. A sudden growth in `failed` jobs usually indicates upstream dependency outages (SMTP, Stripe, S3).

## Draining queues

1. Pause the worker deployment to stop processing:
   ```sh
   kubectl scale deploy/<release>-system-api-worker --replicas=0
   ```
2. Connect to Redis and run `queue.drain()` from a script:
   ```ts
   await queue.drain(true);
   ```
   The `true` flag also cleans waiting delayed jobs.
3. Resume the worker deployment when safe:
   ```sh
   kubectl scale deploy/<release>-system-api-worker --replicas=1
   ```

## Replaying stuck jobs

1. Identify the queue and fetch failed jobs:
   ```ts
   const failed = await queue.getFailed(0, 50);
   ```
2. Review `job.failedReason` and `job.data` for each entry to ensure the root cause is resolved.
3. Retry individually with `await job.retry();` or in bulk with `queue.retryJobs();`.
4. Watch the worker logs (`kubectl logs deploy/<release>-system-api-worker`) to confirm recovery.

## Operational tips

- All processors close their Redis connections cleanly during shutdown signals, so prefer `kubectl rollout restart` over manual pod deletes.
- Invitation and Stripe jobs use exponential backoff; repeated failures usually indicate misconfigured SMTP or Stripe secrets.
- The worker entry point logs `"Singr worker started and ready to process jobs"` after boot (see `src/worker/main.ts`), which is a good liveness indicator when debugging.
