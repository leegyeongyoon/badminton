-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HoldStatus" ADD VALUE 'QUEUED';
ALTER TYPE "HoldStatus" ADD VALUE 'PENDING_ACCEPT';
ALTER TYPE "HoldStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "CourtHold" ADD COLUMN     "acceptDeadline" TIMESTAMP(3),
ADD COLUMN     "queuePosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FacilityPolicy" ADD COLUMN     "maxQueueSize" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "queueAcceptTimeoutSeconds" INTEGER NOT NULL DEFAULT 120;

-- CreateIndex
CREATE INDEX "CourtHold_courtId_status_idx" ON "CourtHold"("courtId", "status");

-- CreateIndex
CREATE INDEX "CourtHold_courtId_queuePosition_idx" ON "CourtHold"("courtId", "queuePosition");
