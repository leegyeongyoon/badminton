#!/usr/bin/env bash
#
# Runs ON the production server (gyoungyoon@100.67.40.34), invoked over SSH by
# .github/workflows/deploy.yml after the source tree is rsynced to /opt/badminton.
#
# Idempotent: build images -> migrate -> (re)start server. Safe to run repeatedly.
#
# Usage:
#   bash scripts/deploy-remote.sh          # normal deploy (no seeding)
#   bash scripts/deploy-remote.sh seed     # run prisma seed once, then exit
#
# Requires a `.env.prod` in the repo root (see .env.prod.example).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

if [[ ! -f .env.prod ]]; then
  echo "ERROR: .env.prod not found in $(pwd). Create it before deploying." >&2
  exit 1
fi

# Bring up the bundled Postgres only when DATABASE_URL targets the 'postgres'
# service host. If DATABASE_URL points at an external/existing DB, we skip it.
USE_BUNDLED_DB=0
if grep -qE '^DATABASE_URL=.*@postgres:' .env.prod; then
  USE_BUNDLED_DB=1
fi

# `seed` subcommand: explicit one-off, never part of the automated deploy.
if [[ "${1:-}" == "seed" ]]; then
  [[ "$USE_BUNDLED_DB" == "1" ]] && $COMPOSE up -d postgres
  echo "==> Seeding database (prisma seed)"
  $COMPOSE run --rm migrate npm run db:seed
  echo "==> Seed complete"
  exit 0
fi

if [[ "$USE_BUNDLED_DB" == "1" ]]; then
  echo "==> Starting bundled Postgres"
  $COMPOSE up -d postgres
fi

echo "==> Building images (server + migrator)"
$COMPOSE build server migrate

echo "==> Applying migrations (prisma migrate deploy)"
$COMPOSE run --rm migrate

echo "==> (Re)starting server"
$COMPOSE up -d server

echo "==> Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy complete:"
$COMPOSE ps
