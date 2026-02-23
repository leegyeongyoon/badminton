/*
  Warnings:

  - You are about to drop the column `isLeader` on the `ClubMember` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ClubMemberRole" AS ENUM ('LEADER', 'STAFF', 'MEMBER');

-- CreateEnum
CREATE TYPE "ClubSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "homeFacilityId" TEXT;

-- AlterTable
ALTER TABLE "ClubMember" DROP COLUMN "isLeader",
ADD COLUMN     "role" "ClubMemberRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "CourtTurn" ADD COLUMN     "clubSessionId" TEXT;

-- AlterTable
ALTER TABLE "RotationSchedule" ADD COLUMN     "clubSessionId" TEXT;

-- CreateTable
CREATE TABLE "ClubSession" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilitySessionId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "ClubSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "courtIds" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClubSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubSession_clubId_status_idx" ON "ClubSession"("clubId", "status");

-- CreateIndex
CREATE INDEX "ClubSession_facilityId_status_idx" ON "ClubSession"("facilityId", "status");

-- CreateIndex
CREATE INDEX "CourtTurn_clubSessionId_idx" ON "CourtTurn"("clubSessionId");

-- CreateIndex
CREATE INDEX "RotationSchedule_clubSessionId_idx" ON "RotationSchedule"("clubSessionId");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_homeFacilityId_fkey" FOREIGN KEY ("homeFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtTurn" ADD CONSTRAINT "CourtTurn_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationSchedule" ADD CONSTRAINT "RotationSchedule_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_facilitySessionId_fkey" FOREIGN KEY ("facilitySessionId") REFERENCES "FacilitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubSession" ADD CONSTRAINT "ClubSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
