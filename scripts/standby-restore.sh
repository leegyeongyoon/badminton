#!/usr/bin/env bash
#
# standby-restore.sh — 파이 웜 스탠바이 데이터 복원 (매일 04:30 cron).
# 비공개 badminton-backups 저장소에서 최신 DB 덤프(+업로드 tar)를 받아
# 파이의 로컬 DB에 복원한다. AWS 장애 시 라우트 전환만으로 이어받기 위함.
#
# 안전장치: /opt/badminton/STANDBY_MODE 마커가 있을 때만 동작 —
# 파이가 프로덕션인 상태에서 실수로 실행돼 실DB를 덮어쓰는 사고 방지.
# (failback으로 파이가 다시 프로덕션이 되면 이 마커를 지울 것 — RUNBOOK 참고)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f STANDBY_MODE ] || { echo "$(date -Is) STANDBY_MODE 마커 없음 — 복원 중단(프로덕션 보호)"; exit 1; }

export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/backup_read_key -o IdentitiesOnly=yes"
cd /opt/badminton-backups
git fetch --depth 1 origin main
git reset --hard FETCH_HEAD >/dev/null

LATEST=$(ls -1 badminton-*.sql.gz 2>/dev/null | sort -r | head -1)
[ -n "$LATEST" ] || { echo "$(date -Is) 백업 저장소에 덤프 없음"; exit 1; }

cd /opt/badminton
docker compose -f docker-compose.prod.yml up -d postgres >/dev/null
bash scripts/restore-db.sh --yes "/opt/badminton-backups/$LATEST" >/dev/null

# 업로드 이미지(있으면) — 서버 컨테이너 볼륨에 주입.
UP=$(ls -1 /opt/badminton-backups/uploads-*.tar.gz 2>/dev/null | sort -r | head -1 || true)
if [ -n "$UP" ] && docker ps --format '{{.Names}}' | grep -q '^badminton-prod-server$'; then
  docker cp "$UP" badminton-prod-server:/tmp/u.tar.gz
  docker exec -u root badminton-prod-server sh -c 'tar xzf /tmp/u.tar.gz -C /app/uploads && chown -R node:node /app/uploads && rm /tmp/u.tar.gz'
fi

COUNT=$(docker compose -f docker-compose.prod.yml exec -T postgres psql -U badminton -d badminton -tAc 'SELECT count(*) FROM "User"' | tr -d '[:space:]')
echo "$(date -Is) standby restore OK: $LATEST User=$COUNT"
