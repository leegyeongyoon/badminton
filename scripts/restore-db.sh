#!/usr/bin/env bash
#
# restore-db.sh — Restore a gzip pg_dump file into the badminton Postgres DB.
#
# !!! DESTRUCTIVE !!! The target database is DROPPED and recreated before the
# dump is streamed in (backup-db.sh produces a plain pg_dump without --clean,
# so restoring on top of an existing schema fails with "already exists").
# Existing connections are force-terminated. You are prompted to confirm
# unless --yes is passed.
#
# Usage:
#   bash scripts/restore-db.sh ./backups/badminton-20260617-120000.sql.gz
#   bash scripts/restore-db.sh --yes ./backups/badminton-...sql.gz
#   DB_NAME=badminton_tmp bash scripts/restore-db.sh --yes <dump>   # restore into a temp DB
#
# Configuration (env vars, prod-safe defaults — same knobs as backup-db.sh):
#   COMPOSE_FILE   compose file        (default: docker-compose.prod.yml)
#   DB_SERVICE    compose service     (default: postgres)
#   DB_NAME       target database     (default: badminton)
#   DB_USER       database user       (default: badminton)
#
set -euo pipefail

cd "$(dirname "$0")/.."

ASSUME_YES=0
DUMP_FILE=""

# Parse args: optional --yes/-y in any position, plus one dump-file path.
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -*)       echo "ERROR: unknown option '$arg'" >&2; exit 2 ;;
    *)        DUMP_FILE="$arg" ;;
  esac
done

if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: bash scripts/restore-db.sh [--yes] <dump.sql.gz>" >&2
  exit 2
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file '$DUMP_FILE' not found." >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-badminton}"
DB_USER="${DB_USER:-badminton}"
COMPOSE="docker compose -f ${COMPOSE_FILE}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: compose file '$COMPOSE_FILE' not found in $(pwd)." >&2
  exit 1
fi

echo "------------------------------------------------------------------"
echo "  RESTORE (DESTRUCTIVE) — this OVERWRITES the target database."
echo "    compose file : ${COMPOSE_FILE}"
echo "    db service   : ${DB_SERVICE}"
echo "    target DB    : ${DB_NAME}  (user ${DB_USER})"
echo "    dump file    : ${DUMP_FILE}"
echo "------------------------------------------------------------------"

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Type 'yes' to OVERWRITE ${DB_NAME} with this dump: " REPLY
  if [[ "$REPLY" != "yes" ]]; then
    echo "Aborted (no confirmation)."
    exit 1
  fi
fi

echo "==> Recreating database '${DB_NAME}' (existing connections terminated)..."

# 덤프에 DROP문이 없으므로 DB를 통째로 재생성해야 한다. WITH (FORCE)가 서버
# 컨테이너 등 살아있는 연결을 끊는다(끊긴 클라이언트는 알아서 재연결).
if ! $COMPOSE exec -T "$DB_SERVICE" \
     psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres \
       -c "DROP DATABASE IF EXISTS \"${DB_NAME}\" WITH (FORCE);" \
       -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"; then
  echo "ERROR: failed to recreate database '${DB_NAME}'." >&2
  exit 1
fi

echo "==> Restoring ${DUMP_FILE} into '${DB_NAME}'..."

# gunzip on the host, pipe SQL into psql inside the container. ON_ERROR_STOP=1
# makes psql exit non-zero on the first SQL error so we don't claim success on a
# partial restore. -T disables TTY for clean streaming.
if ! gunzip -c "$DUMP_FILE" \
     | $COMPOSE exec -T "$DB_SERVICE" \
         psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"; then
  echo "ERROR: restore failed; the target DB may be in a partial state." >&2
  exit 1
fi

echo "==> Restore complete into '${DB_NAME}'."
