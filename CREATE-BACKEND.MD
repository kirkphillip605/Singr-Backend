You are an expert TypeScript/Node.js backend engineer tasked with building the Singr centralized REST API backend described in `CENTRALIZED_API_PLAN.md`. Follow these instructions exactly to avoid breaking existing functionality.

## Objectives
- Deliver a stateless, horizontally scalable REST API service hosted at `system.singrkaraoke.com`.
- Reuse and align with the data model, behaviors, and integrations captured in `CENTRALIZED_API_PLAN.md` (especially entities like venues, systems, api keys, Stripe integration, OpenKJ endpoints).
- Implement the unified users + RBAC + audit logging architecture and Prisma schema defined in the plan.
- Maintain compatibility with existing working behaviors from the Singr Management Portal codebase when mapping to new services.

## Working Constraints
- Stack: Node.js (LTS), TypeScript, Fastify, Zod, Prisma, PostgreSQL (with PostGIS), Redis, BullMQ, Auth.js/NextAuth (JWT), S3-compatible storage (GCS), Stripe SDK, Sentry.
- Security: Argon2id password hashing, strong validation, least-privilege RBAC, secure headers, strict CORS, CSRF for cookie flows, Redis-backed rate limiting.
- Stateless sessions: JWT access tokens, refresh tokens stored hashed in Redis. No server affinity.
- Observability: Sentry integration, structured JSON logging, correlation IDs.
- Infrastructure ready: Docker, 12-factor config via environment variables, health/readiness endpoints.
- No migrations/backward compatibility required for legacy schema; start from the authoritative DDL/Prisma provided.

## Delivery Phases
### Phase 0 – Environment & Baseline
1. Scaffold new `apps/system-api` (or similar) package within monorepo dedicated to API backend.
2. Configure TypeScript project references, ESLint, Prettier, jest/vitest, and shared tooling consistent with repository conventions.
3. Add Dockerfile and docker-compose entries for API, Postgres (with PostGIS), Redis, MinIO (S3 emulation), Mailpit.
4. Install dependencies: fastify, @fastify/cors, @fastify/helmet, zod, prisma, @prisma/client, argon2 (node-rs), jose, bullmq, ioredis, @aws-sdk/client-s3, @auth/core, stripe, pino, pino-pretty (dev), envsafe, @sentry/node, @sentry/tracing, fastify-sse-v2 (if needed), problem-json helper library, supertest (test), vitest/jest.
5. Copy PostgreSQL DDL and Prisma schema from `CENTRALIZED_API_PLAN.md` into `prisma/schema.prisma`. Generate Prisma client and create initial migration.
6. Seed baseline data: default roles, permissions, platform branding profile, admin account placeholder (disabled by default).

### Phase 1 – Core Infrastructure & Middleware
1. Implement config loader reading environment variables with validation (envsafe/zod). Include DB URL, Redis URL, S3, JWT keys, Auth.js secret, Stripe keys, Sentry DSN.
2. Initialize Fastify server with plugins: CORS (domain-based rules), Helmet (security headers), request logging (pino), rate limiting (custom Redis sliding window), request context (CLS for correlation ID and user ID), Sentry instrumentation, JSON schema serialization.
3. Create shared error handling utilities returning Problem+JSON responses with consistent structure.
4. Add authentication middleware: verify JWT via `jose`, extract global roles and context, hydrate permission cache from Redis/Prisma, enforce RBAC guard.
5. Implement helper to set `app.current_user_id` via `SET LOCAL` in Prisma $use middleware for audit logging.
6. Add global hooks for caching (Redis) and request metrics (Prometheus). Provide `/healthz`, `/readyz`, `/metrics` routes.

### Phase 2 – Auth Module
1. Implement `POST /v1/auth/register`, `/register/singer`, `/signin`, `/password/forgot`, `/password/reset`, `/signout` using Argon2id for password hashing and Auth.js flows.
2. Integrate OAuth providers (Google/Apple) with Auth.js `accounts` table. Ensure JWT strategy (no server sessions).
3. Implement `GET /v1/auth/profile` returning user info, roles, organization memberships, singer profile, branding context.
4. Implement `POST /v1/auth/context` for role/org switching. Regenerate JWT with updated `activeContext` claim.
5. Issue refresh tokens (JWT or opaque) stored hashed in Redis. Provide rotation and revocation logic.
6. Enforce rate limits on auth endpoints and add Sentry breadcrumbs for security events.

### Phase 3 – Customer Domain
1. Implement venues CRUD endpoints aligned with PostGIS requirements (geography column). Ensure location updates and caching invalidation.
2. Implement systems CRUD, maintaining unique `(customer_profile_id, openkj_system_id)` constraint.
3. Build API key management endpoints (issue, rotate, revoke). Hash new keys, log in audit, enqueue webhooks.
4. Expose subscriptions endpoints integrated with Stripe (use Stripe SDK). Handle checkout session creation and webhook updates.
5. Implement branding management (list/create/update) including signed upload URL generation for GCS. Enforce asset validation and metadata persistence.
6. Implement organization user management (invite, update, revoke). Send invitation emails via BullMQ worker.
7. Provide song database listing/import endpoints. Bulk import triggers BullMQ job to write to DB and update search indexes.

### Phase 4 – Singer Domain
1. Implement singer profile management (view/update preferences).
2. Build requests endpoint ensuring venue acceptance, rate limits, linking to singer history, and notification jobs.
3. Implement favorites endpoints for songs and venues. Maintain uniqueness constraints and audit logs.
4. Provide history endpoint with pagination and filtering.

### Phase 5 – Admin Domain
1. Build admin endpoints for user management (role assignment, suspension), organization oversight (activate/suspend), audit log querying, branding/branded apps management.
2. Implement ability to assign/remove global roles and manage permission catalog (CRUD for roles/permissions with guard to protect system roles).
3. Expose Stripe webhook event inspection/resend endpoints.
4. Add operational metrics endpoints and guard with admin role.

### Phase 6 – Public & OpenKJ Endpoints
1. Implement public venues and nearby search using PostGIS (`ST_DWithin`, `ST_Distance`) with Redis caching.
2. Implement public song search with caching and invalidation on songdb updates.
3. Provide `/v1/public/branding/platform` returning platform branding profile with signed asset URLs.
4. Port existing OpenKJ command endpoint to `/v1/openkj/api/command`, preserving request/response schema and behavior. Use API key auth consistent with new `api_keys` table.

### Phase 7 – Async Workers & Integrations
1. Create BullMQ worker process handling `email`, `webhooks`, `song_index_refresh`, `cleanup`, and optional `branding_asset_scan` queues.
2. Integrate email provider (e.g., SendGrid) with templating. Add fallback logging for dev.
3. Implement Stripe webhook consumer that updates subscriptions, customers, checkout sessions, logs audit entries, and enqueues follow-up jobs.
4. Add scheduled cleanup jobs (expired invitations, stale requests, audit log archiving) using BullMQ repeatable jobs or external scheduler.

### Phase 8 – Observability, Testing, Hardening
1. Configure Sentry for API and worker with proper release management and environment tagging. Ensure correlation IDs forwarded.
2. Implement structured logging with Pino serializers redacting sensitive fields.
3. Build comprehensive test suite: unit tests for services, integration tests against dockerized Postgres/Redis, contract tests for endpoints (supertest/vitest).
4. Add performance budgets (e.g., ensure /venues list handles 95th percentile < 150ms with warm cache) and load testing scripts (k6).
5. Conduct security review: ensure Argon2 cost factors, enforce password policies, implement content security policy for cookies, verify audit log coverage.

### Phase 9 – Deployment & Documentation
1. Finalize Dockerfile (multi-stage) and runtime entrypoint (migrations + start).
2. Provide Kubernetes manifests or Helm chart template for API, worker, migrations, with secrets placeholders.
3. Document environment variables, runbooks (queue maintenance, audit log restore), and operational dashboards.
4. Create postman/insomnia collections (or OpenAPI spec) documenting REST v1 endpoints.
5. Deliver onboarding guide for frontend teams describing authentication, context switching, and caching expectations.

## Non-negotiables
- Do not change database schema outside what is specified; use migrations if updates are needed after baseline.
- Never log plaintext secrets (passwords, API keys, tokens). Sanitize audit records for hashed fields.
- Maintain compatibility with existing OpenKJ workflows and Stripe data shapes.
- Ensure every mutating endpoint writes audit logs and enqueues relevant jobs when necessary.
- Keep modules cohesive; shared utilities live under `/packages` if multiple services use them.

Follow the phases sequentially. Do not advance to the next phase until the current phase (including tests and docs) is complete and reviewed.
