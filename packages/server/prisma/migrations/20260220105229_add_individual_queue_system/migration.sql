-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('SINGLES', 'DOUBLES', 'MIXED_DOUBLES');

-- CreateEnum
CREATE TYPE "HoldType" AS ENUM ('INDIVIDUAL', 'CLUB');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'PENDING_ACCEPT', 'ACCEPTED', 'SKIPPED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AutoMatchStatus" AS ENUM ('WAITING', 'MATCHED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "CourtHold" ADD COLUMN     "holdType" "HoldType" NOT NULL DEFAULT 'CLUB',
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "clubId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "preferredGameTypes" "GameType"[] DEFAULT ARRAY['DOUBLES']::"GameType"[],
    "gender" TEXT,
    "birthYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT,
    "queueType" "HoldType" NOT NULL DEFAULT 'INDIVIDUAL',
    "position" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptDeadline" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoMatchEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL DEFAULT 'DOUBLES',
    "status" "AutoMatchStatus" NOT NULL DEFAULT 'WAITING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedAt" TIMESTAMP(3),

    CONSTRAINT "AutoMatchEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoShowRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "penaltyEndsAt" TIMESTAMP(3),

    CONSTRAINT "NoShowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySession" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "FacilitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "executeAt" TIMESTAMP(3) NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE INDEX "QueueEntry_courtId_position_idx" ON "QueueEntry"("courtId", "position");

-- CreateIndex
CREATE INDEX "QueueEntry_courtId_status_idx" ON "QueueEntry"("courtId", "status");

-- CreateIndex
CREATE INDEX "QueueEntry_userId_idx" ON "QueueEntry"("userId");

-- CreateIndex
CREATE INDEX "AutoMatchEntry_facilityId_status_gameType_idx" ON "AutoMatchEntry"("facilityId", "status", "gameType");

-- CreateIndex
CREATE UNIQUE INDEX "AutoMatchEntry_userId_facilityId_key" ON "AutoMatchEntry"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "NoShowRecord_userId_facilityId_idx" ON "NoShowRecord"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "NoShowRecord_userId_penaltyEndsAt_idx" ON "NoShowRecord"("userId", "penaltyEndsAt");

-- CreateIndex
CREATE INDEX "FacilitySession_facilityId_status_idx" ON "FacilitySession"("facilityId", "status");

-- CreateIndex
CREATE INDEX "ScheduledJob_executed_executeAt_idx" ON "ScheduledJob"("executed", "executeAt");

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoMatchEntry" ADD CONSTRAINT "AutoMatchEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoMatchEntry" ADD CONSTRAINT "AutoMatchEntry_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowRecord" ADD CONSTRAINT "NoShowRecord_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySession" ADD CONSTRAINT "FacilitySession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySession" ADD CONSTRAINT "FacilitySession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
