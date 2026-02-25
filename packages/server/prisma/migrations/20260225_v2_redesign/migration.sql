-- v2.0 Redesign Migration
-- 1. Skill Level: BEGINNER/INTERMEDIATE/ADVANCED/PRO -> S/A/B/C/D/E/F
-- 2. GameBoard models for 모임판

-- Step 1: Add new skill level values
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'S';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'A';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'B';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'C';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'D';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'E';
ALTER TYPE "SkillLevel" ADD VALUE IF NOT EXISTS 'F';

-- Step 2: Migrate existing data
UPDATE "PlayerProfile" SET "skillLevel" = 'S' WHERE "skillLevel" = 'PRO';
UPDATE "PlayerProfile" SET "skillLevel" = 'B' WHERE "skillLevel" = 'ADVANCED';
UPDATE "PlayerProfile" SET "skillLevel" = 'D' WHERE "skillLevel" = 'INTERMEDIATE';
UPDATE "PlayerProfile" SET "skillLevel" = 'F' WHERE "skillLevel" = 'BEGINNER';

-- Step 3: Create GameBoardEntryStatus enum
CREATE TYPE "GameBoardEntryStatus" AS ENUM ('QUEUED', 'MATERIALIZED', 'PLAYING', 'COMPLETED', 'CANCELLED');

-- Step 4: Create GameBoard table
CREATE TABLE "GameBoard" (
    "id" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBoard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameBoard_clubSessionId_key" ON "GameBoard"("clubSessionId");

-- Step 5: Create GameBoardEntry table
CREATE TABLE "GameBoardEntry" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "playerIds" TEXT[],
    "status" "GameBoardEntryStatus" NOT NULL DEFAULT 'QUEUED',
    "turnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBoardEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameBoardEntry_turnId_key" ON "GameBoardEntry"("turnId");
CREATE INDEX "GameBoardEntry_boardId_courtId_position_idx" ON "GameBoardEntry"("boardId", "courtId", "position");

-- Step 6: Add foreign keys
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameBoard" ADD CONSTRAINT "GameBoard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "GameBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameBoardEntry" ADD CONSTRAINT "GameBoardEntry_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "CourtTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
