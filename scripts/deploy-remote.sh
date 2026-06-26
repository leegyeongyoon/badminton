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
  # Use the COMPILED seed: the migrator image is pruned (--omit=dev) so ts-node
  # is gone; dist/prisma/seed.js runs on production deps only.
  echo "==> Seeding database (compiled seed)"
  $COMPOSE run --rm migrate node dist/prisma/seed.js
  echo "==> Seed complete"
  exit 0
fi

if [[ "$USE_BUNDLED_DB" == "1" ]]; then
  echo "==> Starting bundled Postgres"
  $COMPOSE up -d postgres
fi

echo "==> Building images (server + migrator)"
$COMPOSE build server migrate

# --- Pre-migration backup (DATA-LOSS GUARD) -------------------------------
# Take a full DB dump BEFORE applying migrations. If the backup fails we ABORT
# the deploy rather than migrate an un-backed-up DB. Only relevant when we own
# the bundled Postgres; an external DB is the operator's responsibility.
if [[ "$USE_BUNDLED_DB" == "1" ]]; then
  echo "==> Pre-migration backup"
  if ! bash scripts/backup-db.sh; then
    echo "ERROR: pre-migration backup FAILED. Aborting deploy; NOT running migrations." >&2
    echo "       Fix the backup (DB up? disk space?) and re-run the deploy." >&2
    exit 1
  fi
else
  echo "==> Skipping pre-migration backup (external DATABASE_URL; not managed here)"
fi

echo "==> Applying migrations (prisma migrate deploy)"
$COMPOSE run --rm migrate

# --- Post-migrate sanity check --------------------------------------------
# Surface accidental data wipes: core tables should not be empty after a deploy
# on an existing install. We don't roll back automatically (a fresh DB legitimately
# starts empty), but a count of 0 on a populated install is a loud red flag.
if [[ "$USE_BUNDLED_DB" == "1" ]]; then
  echo "==> Post-migrate sanity check (core table counts)"
  for tbl in User Facility Club; do
    cnt="$($COMPOSE exec -T postgres \
            psql -U badminton -d badminton -tAc "SELECT count(*) FROM \"${tbl}\";" \
            2>/dev/null | tr -d '[:space:]' || echo "ERR")"
    if [[ "$cnt" == "ERR" || -z "$cnt" ]]; then
      echo "    WARNING: could not read count for \"${tbl}\" (table missing or DB error)."
    elif [[ "$cnt" == "0" ]]; then
      echo "    !!! WARNING: core table \"${tbl}\" is EMPTY (count 0) after migrate."
      echo "    !!! If this is an existing install this may indicate DATA LOSS."
      echo "    !!! A pre-migration backup was taken; restore with scripts/restore-db.sh if needed."
    else
      echo "    OK: \"${tbl}\" = ${cnt} row(s)"
    fi
  done
fi

echo "==> (Re)starting server"
$COMPOSE up -d server

echo "==> Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy complete:"
$COMPOSE ps
