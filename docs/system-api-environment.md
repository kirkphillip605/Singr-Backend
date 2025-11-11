# Singr System API environment variables

The System API reads configuration exclusively from environment variables during bootstrap via `envsafe` validation in `apps/system-api/src/config/index.ts`. Override the values below per environment; unspecified values fall back to the defaults documented in code.

## Core service configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode that tunes logging and optional instrumentation. | `development` in local builds, otherwise must be `development`, `test`, or `production`. |
| `HOST` | Interface the Fastify server binds to. | `0.0.0.0` in development. |
| `PORT` | HTTP listen port exposed by the container. | `3000`. |
| `LOG_LEVEL` | Pino log level for the API and worker processes. | `debug` in development, `info` otherwise. |

## Data stores

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string that Prisma uses. | `postgresql://singr:singr@localhost:5432/singr`. |
| `REDIS_URL` | Redis endpoint used for queues, caching, and rate limits. | `redis://127.0.0.1:6379/0`. |

## Authentication & authorization

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUTH_SECRET` | Symmetric secret for password hashing salts and fallback HMACs. | _Required_. |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | PEM-encoded asymmetric keys for signing and verifying API tokens. | _Required_. |
| `REFRESH_TOKEN_TTL_SECONDS` | Refresh token lifetime that is shared with Redis storage. | `604800` seconds (7 days). |

## Object storage

| Variable | Purpose | Default |
| --- | --- | --- |
| `S3_ENDPOINT` | Base URL for S3-compatible object storage. | `http://127.0.0.1:9000`. |
| `S3_ACCESS_KEY_ID` | Storage access key. | `singr`. |
| `S3_SECRET_ACCESS_KEY` | Storage secret key. | `singr-secret`. |
| `S3_BUCKET` | Bucket that stores branding uploads and other assets. | `singr-assets`. |
| `S3_USE_SSL` | Enables HTTPS when connecting to storage. | `false` locally, `true` by default in production. |

## Commerce integrations

| Variable | Purpose | Default |
| --- | --- | --- |
| `STRIPE_API_KEY` | Secret key for Stripe API access. Leave empty to disable Stripe features. | _Empty string_. |
| `STRIPE_WEBHOOK_SECRET` | Verifies webhook signatures for Stripe events. | _Empty string_. |

## Email delivery

| Variable | Purpose | Default |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Selects the email backend (`console` logs locally, `smtp` for production). | `console`. |
| `EMAIL_FROM_ADDRESS` | Default sender address for transactional mail. | `no-reply@singr.test`. |
| `EMAIL_FROM_NAME` | Friendly sender name. | `Singr Team`. |
| `EMAIL_LOG_MESSAGES` | Enables body logging in non-production environments. | `true` locally, `false` otherwise. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP connection details when `EMAIL_PROVIDER=smtp`. | Host empty, port `587`, TLS disabled in development. |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | Optional credentials for SMTP auth. | Empty. |

## Observability & security

| Variable | Purpose | Default |
| --- | --- | --- |
| `SENTRY_DSN` | Enables Sentry reporting when populated. | Empty. |
| `SENTRY_TRACES_SAMPLE_RATE` | Trace sampling rate for HTTP spans. | `0.1`. |
| `SENTRY_PROFILES_SAMPLE_RATE` | Profiling sampling rate. | `0.0`. |
| `SENTRY_ENVIRONMENT` | Overrides the reported Sentry environment. | Defaults to `NODE_ENV`. |
| `SENTRY_RELEASE` / `SENTRY_SERVER_NAME` | Optional metadata forwarded to Sentry. | Empty. |
| `CORS_ALLOWED_ORIGINS` | Comma-delimited list of allowed origins for browser clients. | Empty list (rejects all origins). |
| `RATE_LIMIT_DEFAULT_WINDOW_MS` | Duration of the sliding window for default rate limits. | `60000`. |
| `RATE_LIMIT_DEFAULT_MAX` | Maximum requests per window. | `120` in development, `100` otherwise. |
| `RATE_LIMIT_TRUST_PROXY` | Whether to respect `X-Forwarded-For` headers. | `true` locally, `false` otherwise. |
| `METRICS_ENABLED` | Enables Prometheus metrics and `/metrics` endpoint. | `true`. |

## Cache tuning

The System API caches frequently accessed resources in Redis. Tweak the following TTLs (in seconds) to tune staleness versus load:

- Venue list cache: `VENUES_CACHE_TTL_SECONDS` (`300`).
- System list cache: `SYSTEMS_CACHE_TTL_SECONDS` (`300`).
- API key cache: `API_KEYS_CACHE_TTL_SECONDS` (`120`).
- Subscription cache: `SUBSCRIPTIONS_CACHE_TTL_SECONDS` (`120`).
- Branding profile cache: `BRANDING_CACHE_TTL_SECONDS` (`600`).
- Organization user cache: `ORG_USERS_CACHE_TTL_SECONDS` (`300`).
- Song database ingest cache: `SONGDB_CACHE_TTL_SECONDS` (`60`).
- Singer profile cache: `SINGER_PROFILE_CACHE_TTL_SECONDS` (`120`).
- Singer favorites cache: `SINGER_FAVORITES_CACHE_TTL_SECONDS` (`120`).
- Singer history cache: `SINGER_HISTORY_CACHE_TTL_SECONDS` (`60`).
- Public venue search cache: `PUBLIC_VENUES_CACHE_TTL_SECONDS` (`300`).
- Public song search cache: `PUBLIC_SONGS_CACHE_TTL_SECONDS` (`300`).

## Branding, invitations, and singer throttles

| Variable | Purpose | Default |
| --- | --- | --- |
| `BRANDING_UPLOAD_URL_TTL_SECONDS` | Signed upload URL validity window. | `900`. |
| `ORG_INVITATION_TTL_SECONDS` | Duration invitations remain valid. | `86400`. |
| `ORG_INVITATION_BASE_URL` | Link prefix used when emailing organization invitations. | `https://app.singr.test/invite`. |
| `SINGER_REQUEST_LIMIT_PER_SINGER` / `SINGER_REQUEST_WINDOW_MS_PER_SINGER` | Rate limit per singer account. | `10` requests per `300000` ms. |
| `SINGER_REQUEST_LIMIT_PER_VENUE` / `SINGER_REQUEST_WINDOW_MS_PER_VENUE` | Rate limit per venue. | `30` requests per `300000` ms. |
