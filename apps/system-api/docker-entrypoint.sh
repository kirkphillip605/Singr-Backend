#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/app"
API_ROOT="$APP_ROOT/apps/system-api"

if [ "$#" -gt 0 ]; then
  CMD=("$@")
else
  CMD=("node" "$API_ROOT/dist/main.js")
fi

if [ "${RUN_DB_MIGRATIONS:-true}" != "false" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy --schema "$API_ROOT/prisma/schema.prisma"
fi

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  npx prisma db seed --schema "$API_ROOT/prisma/schema.prisma"
fi

echo "Starting Singr System API with command: ${CMD[*]}"
exec "${CMD[@]}"
