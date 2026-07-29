-- 실험실 "회비 관리 + 게스트 사전 신청" (전부 additive/nullable — 무중단)

-- Club: 회비 설정(주기·정모참가비·게스트비·입금계좌)
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "duesAccountInfo" TEXT;
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "duesPeriodType" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "perSessionFee" INTEGER;
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "guestFee" INTEGER;

-- ClubSession: 정모 대관비(엔빵 총액)
ALTER TABLE "ClubSession" ADD COLUMN IF NOT EXISTS "rentalCost" INTEGER;

-- GuestApplication: 게스트 사전 신청(공개 링크)
CREATE TABLE IF NOT EXISTS "GuestApplication" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "skillLevel" TEXT,
  "gender" TEXT,
  "visitDate" TEXT,
  "phone" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "feeAmount" INTEGER,
  "feePaid" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GuestApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GuestApplication_clubId_createdAt_idx" ON "GuestApplication"("clubId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "GuestApplication" ADD CONSTRAINT "GuestApplication_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 모임 공개/비공개 + 앱 회원 신청 연결
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "GuestApplication" ADD COLUMN IF NOT EXISTS "userId" TEXT;
