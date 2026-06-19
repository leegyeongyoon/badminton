-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "checkInLat" DOUBLE PRECISION,
ADD COLUMN     "checkInLng" DOUBLE PRECISION,
ADD COLUMN     "clubSessionId" TEXT;

-- AlterTable
ALTER TABLE "ClubSession" ADD COLUMN     "checkInClosesAt" TIMESTAMP(3),
ADD COLUMN     "checkInOpensAt" TIMESTAMP(3),
ADD COLUMN     "scheduledStartAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "FacilityPolicy" ADD COLUMN     "checkinRadiusM" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "checkinWindowMinutes" INTEGER DEFAULT 60;

-- CreateIndex
CREATE INDEX "CheckIn_clubSessionId_checkedOutAt_idx" ON "CheckIn"("clubSessionId", "checkedOutAt");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
