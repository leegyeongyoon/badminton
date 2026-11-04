-- 게임 기록이 쌓일수록 느려지는 조회 두 가지에 인덱스(로컬 시험 DB 66만 줄에서 확인).
CREATE INDEX IF NOT EXISTS "TurnPlayer_userId_idx" ON "TurnPlayer"("userId");
CREATE INDEX IF NOT EXISTS "CheckIn_facilityId_checkedOutAt_idx" ON "CheckIn"("facilityId", "checkedOutAt");
