# syntax=docker/dockerfile:1.5

FROM node:20-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app

FROM base AS deps
ENV NODE_ENV=development
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/system-api/package.json apps/system-api/
RUN npm install --include-workspace-root=false

FROM base AS builder
ENV NODE_ENV=development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate --workspace @singr/system-api
RUN npm run build --workspace @singr/system-api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/system-api/dist ./apps/system-api/dist
COPY --from=builder /app/apps/system-api/prisma ./apps/system-api/prisma
COPY apps/system-api/package.json apps/system-api/package.json
EXPOSE 3000
CMD ["node", "apps/system-api/dist/main.js"]
