# Frontend onboarding guide

Welcome to Singr! This guide summarizes how web and mobile clients authenticate with the System API, how caching behaves across major resources, and where to find the reference documentation.

## Authentication flow

1. **Registration**
   - Staff and venue operators call `POST /v1/auth/register` with `email`, `password`, and optional organization metadata to create an account. The response contains an access token, refresh token, and the claims object described in the OpenAPI spec.
   - Singers self-register with `POST /v1/auth/register/singer` using a shorter payload focused on nickname/display name.
2. **Sign in**
   - All actors exchange credentials via `POST /v1/auth/signin` to receive a session bundle (access token + refresh token).
   - Access tokens expire after 15 minutes (`TokenService.ACCESS_TOKEN_TTL_SECONDS`); refresh tokens expire after 7 days (`REFRESH_TOKEN_TTL_SECONDS`).
3. **Authenticated calls**
   - Include `Authorization: Bearer <accessToken>` on every protected request.
   - Use `GET /v1/auth/profile` immediately after sign-in to hydrate UI state with organizations, permissions, and singer profile details.
4. **Context switching**
   - If a user belongs to multiple organizations, call `POST /v1/auth/context` with `{ "type": "customer", "id": "..." }` to mint a context-specific access token without forcing a full sign-in.
5. **Session renewal**
   - The refresh endpoint has not been implemented yet; when an access token expires and the refresh token becomes invalid, prompt the user to sign in again.
   - Always call `POST /v1/auth/signout` when the user logs out to revoke outstanding refresh tokens.

## API surface area

- The canonical contract lives in `docs/api/system-api.openapi.yaml`. Import it into Stoplight, Postman, or Insomnia to explore request/response schemas.
- API categories:
  - Customer operations under `/v1/customer/*` (venues, systems, subscriptions, API keys, branding, organization users, song database ingestion).
  - Singer-first workflows under `/v1/singer/*` (profile management, queue requests, favorites, history).
  - Public, unauthenticated discovery under `/v1/public/*` (nearby venues, song search, platform branding).

## Caching expectations

Redis-backed caches accelerate list/detail reads and are controlled via TTLs in `apps/system-api/src/config/index.ts`:

- Customer venue list cache (`VENUES_CACHE_TTL_SECONDS`, default 300s) and system cache (`SYSTEMS_CACHE_TTL_SECONDS`, default 300s) mean UI changes may take up to 5 minutes to reflect on other clients.
- API key and subscription caches (`API_KEYS_CACHE_TTL_SECONDS`, `SUBSCRIPTIONS_CACHE_TTL_SECONDS`, both default 120s) keep dashboards snappy—provide manual refresh buttons when immediate consistency matters.
- Singer profile, favorites, and history caches (`SINGER_PROFILE_CACHE_TTL_SECONDS`, `SINGER_FAVORITES_CACHE_TTL_SECONDS`, `SINGER_HISTORY_CACHE_TTL_SECONDS`) default to 120/120/60 seconds respectively; optimistic UI updates should merge server responses when they arrive.
- Public search endpoints cache results for 5 minutes (`PUBLIC_VENUES_CACHE_TTL_SECONDS`, `PUBLIC_SONGS_CACHE_TTL_SECONDS`). Consider showing a timestamp when rendering cached search data.

## Observability hooks

- All HTTP responses include structured logging keyed by `X-Request-Id`. Forward that header from clients to correlate traces.
- Metrics (`GET /metrics`) expose `system_api_http_request_duration_seconds` histograms grouped by route. Tie dashboards back to client operations during launch readiness.
- Queue outcomes (email invites, Stripe sync, branding scans) surface through BullMQ; operational runbooks live under `docs/runbooks/`.

## Developer checklist

- Review the [environment variable catalog](../system-api-environment.md) before deploying preview environments.
- Use the Docker image produced by `apps/system-api/Dockerfile`; it runs Prisma migrations automatically on start.
- When integrating caching-sensitive views, expose manual refresh controls or poll endpoints on longer intervals aligned with TTL defaults.
