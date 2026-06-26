#!/usr/bin/env bash
#
# backup-db.sh — Dump the badminton Postgres DB to a timestamped gzip file.
#
# Runs pg_dump INSIDE the db container (no host psql client needed) and streams
# the output through gzip on the host. Works on the Pi (prod compose) and on a
# local dev box (dev compose) by overriding COMPOSE_FILE / DB_SERVICE.
#
# Usage:
#   bash scripts/backup-db.sh                    # uses prod defaults
#   COMPOSE_FILE=docker-compose.yml bash scripts/backup-db.sh   # local dev
#
# Configuration (all via environment variables, with safe prod defaults):
#   COMPOSE_FILE            compose file to use   (default: docker-compose.prod.yml)
#   DB_SERVICE             compose service name   (default: postgres)
#   DB_NAME               database name          (default: badminton)
#   DB_USER               database user          (default: badminton)
#   BACKUP_DIR            output directory        (default: ./backups)
#   BACKUP_RETENTION_DAYS  prune dumps older than (default: 14)
#   BACKUP_UPLOAD_CMD      optional off-device upload hook (see TODO below)
#
# Exits non-zero if the dump fails (so callers, e.g. deploy-remote.sh, can abort).
set -euo pipefail

# Resolve repo root so the script works regardless of the caller's CWD.
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_SERVICE="${DB_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-badminton}"
DB_USER="${DB_USER:-badminton}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

COMPOSE="docker compose -f ${COMPOSE_FILE}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: compose file '$COMPOSE_FILE' not found in $(pwd)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTFILE="${BACKUP_DIR%/}/${DB_NAME}-${TIMESTAMP}.sql.gz"
# Write to a .partial file first so a crash never leaves a truncated dump that
# looks like a valid backup. We rename only on success.
TMPFILE="${OUTFILE}.partial"

echo "==> Backing up DB '${DB_NAME}' (service '${DB_SERVICE}', compose '${COMPOSE_FILE}')"

# pg_dump runs inside the container; -T disables TTY so it streams cleanly.
# pipefail (set above) makes the pipeline fail if pg_dump fails even though gzip
# would otherwise succeed on empty input.
if ! $COMPOSE exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -c > "$TMPFILE"; then
  echo "ERROR: pg_dump failed; backup NOT created." >&2
  rm -f "$TMPFILE"
  exit 1
fi

# Guard against a "successful" but empty/near-empty dump (e.g. container died
# mid-stream): a real pg_dump of this schema is comfortably over 1 KB gzipped.
ACTUAL_BYTES="$(wc -c < "$TMPFILE" | tr -d '[:space:]')"
if [[ "$ACTUAL_BYTES" -lt 100 ]]; then
  echo "ERROR: dump is suspiciously small (${ACTUAL_BYTES} bytes); treating as failure." >&2
  rm -f "$TMPFILE"
  exit 1
fi

mv "$TMPFILE" "$OUTFILE"

# Human-readable size; -h is BSD+GNU compatible.
SIZE="$(ls -lh "$OUTFILE" | awk '{print $5}')"
echo "==> Backup created: ${OUTFILE} (${SIZE})"

# ---------------------------------------------------------------------------
# Retention: prune dumps older than BACKUP_RETENTION_DAYS. Only touches files
# matching our own naming pattern in BACKUP_DIR (never recurses elsewhere).
# ---------------------------------------------------------------------------
if [[ "$BACKUP_RETENTION_DAYS" -gt 0 ]]; then
  echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} day(s) in ${BACKUP_DIR}"
  PRUNED=0
  while IFS= read -r -d '' old; do
    rm -f "$old" && echo "    pruned: $old" && PRUNED=$((PRUNED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.sql.gz" \
             -mtime +"$BACKUP_RETENTION_DAYS" -print0)
  echo "    pruned ${PRUNED} file(s)"
fi

# ---------------------------------------------------------------------------
# TODO (USER ACTION): OFF-DEVICE STORAGE.
# A backup that lives only on the Pi's SD card is NOT safe from data loss (card
# death, theft, fire). Copy each dump off the device. Set BACKUP_UPLOAD_CMD to a
# command that receives the dump path as its single argument, e.g.:
#
#   export BACKUP_UPLOAD_CMD='rclone copyto "$1" remote:badminton-backups/$(basename "$1")'
#   # or:  export BACKUP_UPLOAD_CMD='aws s3 cp "$1" s3://my-bucket/badminton/'
#
# Until you set this, dumps are LOCAL-ONLY. See scripts/BACKUP.md.
# ---------------------------------------------------------------------------
if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  echo "==> Uploading off-device via BACKUP_UPLOAD_CMD"
  if ! bash -c "$BACKUP_UPLOAD_CMD" _ "$OUTFILE"; then
    # Upload failure must not destroy the local dump, but should be loud and
    # non-zero so a scheduler/operator notices the off-site copy didn't happen.
    echo "ERROR: BACKUP_UPLOAD_CMD failed; local dump kept at ${OUTFILE}." >&2
    exit 1
  fi
  echo "==> Off-device upload complete"
fi

echo "==> Done."
