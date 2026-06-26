# Database backup & restore

Postgres runs in Docker (`postgres` service). These scripts dump/restore it via
`pg_dump`/`psql` run **inside** the container, so no host Postgres client is needed.

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `scripts/backup-db.sh`  | Dumps the DB to a timestamped `*.sql.gz`, prunes old dumps, optional off-device upload. |
| `scripts/restore-db.sh` | Restores a `*.sql.gz` dump back into the DB (**destructive, overwrites**). |

The deploy (`scripts/deploy-remote.sh`) automatically takes a **pre-migration
backup** and **aborts the deploy if the backup fails**, then runs a post-migrate
sanity check on core tables (`User`, `Facility`, `Club`).

## Backup

```bash
# Production (defaults: docker-compose.prod.yml, service "postgres", db/user "badminton")
bash scripts/backup-db.sh

# Local dev DB (docker-compose.yml)
COMPOSE_FILE=docker-compose.yml bash scripts/backup-db.sh
```

Config via env vars (defaults shown): `COMPOSE_FILE=docker-compose.prod.yml`,
`DB_SERVICE=postgres`, `DB_NAME=badminton`, `DB_USER=badminton`,
`BACKUP_DIR=./backups`, `BACKUP_RETENTION_DAYS=14`.

## Restore

> **DESTRUCTIVE — overwrites the target database.** You'll be prompted to type
> `yes`; pass `--yes` to skip the prompt (e.g. in automation).

```bash
# Restore into the real DB (asks for confirmation)
bash scripts/restore-db.sh ./backups/badminton-YYYYMMDD-HHMMSS.sql.gz

# Restore into a TEMP DB for verification (non-destructive to the real one):
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U badminton -d postgres -c 'CREATE DATABASE badminton_verify;'
DB_NAME=badminton_verify bash scripts/restore-db.sh --yes ./backups/badminton-....sql.gz
```

---

## USER ACTIONS (set these up on the Pi)

### 1. Schedule backups with cron  — **USER ACTION**

On the Raspberry Pi, `crontab -e` and add (adjust the repo path):

```cron
# Hourly badminton DB backup, 14-day local retention. Logs to backup.log.
0 * * * * cd /opt/badminton && /usr/bin/env BACKUP_RETENTION_DAYS=14 bash scripts/backup-db.sh >> /opt/badminton/backups/backup.log 2>&1
```

Daily instead of hourly:

```cron
0 3 * * * cd /opt/badminton && bash scripts/backup-db.sh >> /opt/badminton/backups/backup.log 2>&1
```

`cron` has a minimal `PATH`; ensure `docker` is reachable (`which docker` →
usually `/usr/bin/docker`). If not, prefix the line with
`PATH=/usr/bin:/usr/local/bin:$PATH`.

### 2. Off-device storage  — **USER ACTION (IMPORTANT)**

Dumps on the Pi's SD card are **not** safe from card death/theft/fire. Copy each
dump off-device by setting `BACKUP_UPLOAD_CMD` — it runs after each successful
dump with the dump path as `$1`. There is a clearly-marked TODO hook for this in
`scripts/backup-db.sh`.

```bash
# rclone (any cloud / Google Drive / Backblaze, etc.)
export BACKUP_UPLOAD_CMD='rclone copyto "$1" remote:badminton-backups/$(basename "$1")'

# OR AWS S3
export BACKUP_UPLOAD_CMD='aws s3 cp "$1" s3://my-bucket/badminton/'
```

In cron, set it inline on the command (env in the crontab line), e.g.:

```cron
0 * * * * cd /opt/badminton && BACKUP_UPLOAD_CMD='rclone copyto "$1" remote:badminton-backups/$(basename "$1")' bash scripts/backup-db.sh >> /opt/badminton/backups/backup.log 2>&1
```

If `BACKUP_UPLOAD_CMD` fails, the script exits non-zero (so cron/you notice) but
keeps the local dump.

### 3. Test your restore  — **USER ACTION**

A backup you've never restored is a guess. Periodically restore the latest dump
into a temp DB (see "Restore into a TEMP DB" above) and check a row count.
