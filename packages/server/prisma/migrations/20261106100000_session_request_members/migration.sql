-- 운영진 예외 요청: 4명을 지정해 같이 한 판(kind GAME)
ALTER TABLE "SessionRequest" ADD COLUMN IF NOT EXISTS "memberIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
