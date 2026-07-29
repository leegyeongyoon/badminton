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

-- 운영 정보(운동 일정) + 게스트 신청 정책
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "weeklySchedule" JSONB;
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "guestApplyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "guestApplyDeadlineHours" INTEGER;
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "maxGuestsPerDay" INTEGER;

-- 신청 ↔ 당일 체크인 매칭
ALTER TABLE "GuestApplication" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);

-- 레슨 중개 MVP
CREATE TABLE IF NOT EXISTS "LessonOffer" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "coachName" TEXT NOT NULL,
  "day" INTEGER NOT NULL,
  "start" TEXT NOT NULL,
  "end" TEXT NOT NULL,
  "fee" INTEGER,
  "capacity" INTEGER,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonOffer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LessonOffer_clubId_idx" ON "LessonOffer"("clubId");
DO $$ BEGIN
  ALTER TABLE "LessonOffer" ADD CONSTRAINT "LessonOffer_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "LessonApplication" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LessonApplication_offerId_createdAt_idx" ON "LessonApplication"("offerId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "LessonApplication" ADD CONSTRAINT "LessonApplication_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "LessonOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 레슨: 코치 프로필 + 요일 묶음(월수금)
ALTER TABLE "LessonOffer" ADD COLUMN IF NOT EXISTS "coachIntro" TEXT;
ALTER TABLE "LessonOffer" ADD COLUMN IF NOT EXISTS "coachCareer" TEXT;
ALTER TABLE "LessonOffer" ADD COLUMN IF NOT EXISTS "days" JSONB;

-- 운영진 문의 채널(게스트 신청 페이지 노출)
ALTER TABLE "Club" ADD COLUMN IF NOT EXISTS "contactInfo" TEXT;

-- 게스트 문의 채팅
CREATE TABLE IF NOT EXISTS "GuestThread" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "guestUserId" TEXT,
  "guestName" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastText" VARCHAR(200),
  "guestUnread" INTEGER NOT NULL DEFAULT 0,
  "staffUnread" INTEGER NOT NULL DEFAULT 0,
  "closed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestThread_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GuestThread_clubId_lastMessageAt_idx" ON "GuestThread"("clubId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "GuestThread_guestUserId_idx" ON "GuestThread"("guestUserId");
DO $$ BEGIN
  ALTER TABLE "GuestThread" ADD CONSTRAINT "GuestThread_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GuestMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "fromStaff" BOOLEAN NOT NULL,
  "userId" TEXT,
  "authorName" TEXT NOT NULL,
  "text" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GuestMessage_threadId_createdAt_idx" ON "GuestMessage"("threadId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "GuestThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
