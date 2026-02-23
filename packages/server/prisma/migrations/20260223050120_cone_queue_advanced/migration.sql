-- CreateEnum
CREATE TYPE "CourtGameType" AS ENUM ('DOUBLES', 'LESSON');

-- CreateEnum
CREATE TYPE "RecruitmentStatus" AS ENUM ('RECRUITING', 'FULL', 'REGISTERED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "restingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES';

-- AlterTable
ALTER TABLE "CourtTurn" ADD COLUMN     "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES',
ADD COLUMN     "timeLimitAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FacilityPolicy" ADD COLUMN     "gameDurationMinutes" INTEGER,
ADD COLUMN     "gameWarningMinutes" INTEGER DEFAULT 2;

-- CreateTable
CREATE TABLE "GroupRecruitment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "gameType" "CourtGameType" NOT NULL DEFAULT 'DOUBLES',
    "playersRequired" INTEGER NOT NULL DEFAULT 4,
    "targetCourtId" TEXT,
    "status" "RecruitmentStatus" NOT NULL DEFAULT 'RECRUITING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "registeredTurnId" TEXT,

    CONSTRAINT "GroupRecruitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentMember" (
    "id" TEXT NOT NULL,
    "recruitmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupRecruitment_registeredTurnId_key" ON "GroupRecruitment"("registeredTurnId");

-- CreateIndex
CREATE INDEX "GroupRecruitment_facilityId_status_idx" ON "GroupRecruitment"("facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentMember_recruitmentId_userId_key" ON "RecruitmentMember"("recruitmentId", "userId");

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_targetCourtId_fkey" FOREIGN KEY ("targetCourtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupRecruitment" ADD CONSTRAINT "GroupRecruitment_registeredTurnId_fkey" FOREIGN KEY ("registeredTurnId") REFERENCES "CourtTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentMember" ADD CONSTRAINT "RecruitmentMember_recruitmentId_fkey" FOREIGN KEY ("recruitmentId") REFERENCES "GroupRecruitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentMember" ADD CONSTRAINT "RecruitmentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
