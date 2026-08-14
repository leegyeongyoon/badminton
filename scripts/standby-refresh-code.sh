#!/usr/bin/env bash
#
# standby-refresh-code.sh — 파이 웜 스탠바이 코드 신선도 (매주 일 04:00 cron).
# GitHub(공개 저장소)에서 최신 소스를 받아 /opt/badminton을 갱신하고 이미지를
# 리빌드한다. 데이터는 standby-restore.sh(매일)가, 코드는 이 스크립트가 담당.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f STANDBY_MODE ] || { echo "$(date -Is) STANDBY_MODE 마커 없음 — 중단(프로덕션 보호)"; exit 1; }

rm -rf /tmp/bmt-src
git clone --depth 1 https://github.com/leegyeongyoon/badminton.git /tmp/bmt-src
SHA=$(git -C /tmp/bmt-src rev-parse --short HEAD)
rsync -a --delete \
  --exclude '.env.prod' --exclude 'backups' --exclude 'backups-repo' --exclude 'STANDBY_MODE' \
  --exclude 'standby.log' --exclude '*.status' --exclude 'deploy.log' \
  --exclude '.git' --exclude 'node_modules' --exclude 'packages/mobile' \
  /tmp/bmt-src/ /opt/badminton/
rm -rf /tmp/bmt-src

docker compose -f docker-compose.prod.yml build server migrate
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d server
docker image prune -f >/dev/null
echo "$(date -Is) standby code refresh OK: $SHA"
