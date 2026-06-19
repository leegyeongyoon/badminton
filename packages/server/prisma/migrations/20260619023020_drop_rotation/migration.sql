/*
  Warnings:

  - You are about to drop the `RotationPlayer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RotationSchedule` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RotationSlot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RotationPlayer" DROP CONSTRAINT "RotationPlayer_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "RotationPlayer" DROP CONSTRAINT "RotationPlayer_userId_fkey";

-- DropForeignKey
ALTER TABLE "RotationSchedule" DROP CONSTRAINT "RotationSchedule_clubSessionId_fkey";

-- DropForeignKey
ALTER TABLE "RotationSchedule" DROP CONSTRAINT "RotationSchedule_createdById_fkey";

-- DropForeignKey
ALTER TABLE "RotationSchedule" DROP CONSTRAINT "RotationSchedule_facilityId_fkey";

-- DropForeignKey
ALTER TABLE "RotationSchedule" DROP CONSTRAINT "RotationSchedule_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "RotationSlot" DROP CONSTRAINT "RotationSlot_courtId_fkey";

-- DropForeignKey
ALTER TABLE "RotationSlot" DROP CONSTRAINT "RotationSlot_scheduleId_fkey";

-- DropTable
DROP TABLE "RotationPlayer";

-- DropTable
DROP TABLE "RotationSchedule";

-- DropTable
DROP TABLE "RotationSlot";

-- DropEnum
DROP TYPE "RotationStatus";
