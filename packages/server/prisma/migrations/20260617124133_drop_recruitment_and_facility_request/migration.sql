/*
  Warnings:

  - You are about to drop the `FacilityRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GroupRecruitment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RecruitmentMember` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FacilityRequest" DROP CONSTRAINT "FacilityRequest_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "FacilityRequest" DROP CONSTRAINT "FacilityRequest_userId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRecruitment" DROP CONSTRAINT "GroupRecruitment_createdById_fkey";

-- DropForeignKey
ALTER TABLE "GroupRecruitment" DROP CONSTRAINT "GroupRecruitment_facilityId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRecruitment" DROP CONSTRAINT "GroupRecruitment_registeredTurnId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRecruitment" DROP CONSTRAINT "GroupRecruitment_targetCourtId_fkey";

-- DropForeignKey
ALTER TABLE "RecruitmentMember" DROP CONSTRAINT "RecruitmentMember_recruitmentId_fkey";

-- DropForeignKey
ALTER TABLE "RecruitmentMember" DROP CONSTRAINT "RecruitmentMember_userId_fkey";

-- DropTable
DROP TABLE "FacilityRequest";

-- DropTable
DROP TABLE "GroupRecruitment";

-- DropTable
DROP TABLE "RecruitmentMember";

-- DropEnum
DROP TYPE "FacilityRequestStatus";

-- DropEnum
DROP TYPE "RecruitmentStatus";
