# syntax=docker/dockerfile:1.5

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
ENV NODE_ENV=development
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/system-api/package.json apps/system-api/
RUN npm ci --include-workspace-root=false

FROM deps AS builder
COPY . .
RUN npm run prisma:generate --workspace @singr/system-api
RUN npm run build --workspace @singr/system-api

FROM deps AS prod-deps
RUN npm prune --omit=dev

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/package-lock.json ./package-lock.json
COPY --from=prod-deps /app/apps/system-api/package.json ./apps/system-api/package.json
COPY --from=builder /app/apps/system-api/dist ./apps/system-api/dist
COPY --from=builder /app/apps/system-api/prisma ./apps/system-api/prisma
COPY apps/system-api/docker-entrypoint.sh ./apps/system-api/docker-entrypoint.sh
RUN chmod +x ./apps/system-api/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./apps/system-api/docker-entrypoint.sh"]
