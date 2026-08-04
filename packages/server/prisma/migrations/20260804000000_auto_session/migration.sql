-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "autoSessionCourtCount" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "autoSessionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoSessionOpenMinutes" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "ClubSession" ADD COLUMN     "autoSlotKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClubSession_autoSlotKey_key" ON "ClubSession"("autoSlotKey");

