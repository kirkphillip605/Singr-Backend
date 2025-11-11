# Security Validation Checklist

This document summarises the baseline security controls validated for the Singr System API deployment.

## Authentication & Password Policy

- Passwords are validated against a minimum length of 12 characters (10 for singer self-service onboarding) via the Zod schemas in `routes/auth/index.ts`.
- Argon2id hashing parameters (timeCost = 2, memoryCost = 19 456 KiB, parallelism = 1) are enforced through `auth/password-hasher.ts`.
- Request failures emit correlation-aware breadcrumbs in Sentry, enabling traceability without storing raw secrets.

## Content Security Policy

- `@fastify/helmet` provides the default CSP template; we extend it to block inline scripts and restrict connections to Singr-managed origins.
- OpenKJ command ingestion is isolated under a dedicated path with explicit `Content-Type` checking to avoid script injection.
- CSP violations emit structured logs (redacted) and are correlated with request IDs for follow-up triage.

## Audit & Event Logging

- Sensitive mutations (branding status changes, subscription updates) create audit log rows with before/after snapshots and user context.
- Structured logging strips secrets and propagates correlation IDs, ensuring alignment with Sentry traces.
- Weekly jobs export audit deltas for compliance reviews; coverage is tracked in the worker maintenance queue definitions.

## Operational Safeguards

- Sentry alerts include release tags (`SENTRY_RELEASE`) and environment metadata, allowing incident responders to pivot quickly.
- Rate limits remain enforced even during maintenance, preventing credential stuffing bursts.
- Load-test baselines (see `apps/system-api/perf/baseline.md`) are revisited monthly to detect regression.

## To-do / Follow-ups

- Automate CSP report collection via a dedicated endpoint and dashboard.
- Expand password history checks to prevent reuse within the last 12 rotations.
- Integrate dependency vulnerability scanning with CI to catch transitive issues surfaced by npm audit.
