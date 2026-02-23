-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RotationSchedule" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "RotationStatus" NOT NULL DEFAULT 'DRAFT',
    "totalRounds" INTEGER NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "playerCount" INTEGER NOT NULL,
    "courtCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RotationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationSlot" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "courtIndex" INTEGER NOT NULL,
    "courtId" TEXT NOT NULL,
    "playerIds" TEXT[],
    "turnId" TEXT,
    "materialized" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RotationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationPlayer" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gamesAssigned" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "sittingOut" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RotationPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RotationSchedule_facilityId_status_idx" ON "RotationSchedule"("facilityId", "status");

-- CreateIndex
CREATE INDEX "RotationSlot_scheduleId_round_idx" ON "RotationSlot"("scheduleId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "RotationSlot_scheduleId_round_courtIndex_key" ON "RotationSlot"("scheduleId", "round", "courtIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RotationPlayer_scheduleId_userId_key" ON "RotationPlayer"("scheduleId", "userId");

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FacilitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSlot" ADD CONSTRAINT "RotationSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RotationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSlot" ADD CONSTRAINT "RotationSlot_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlayer" ADD CONSTRAINT "RotationPlayer_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RotationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationPlayer" ADD CONSTRAINT "RotationPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
