-- DropIndex
DROP INDEX "Court_facilityId_name_key";

-- AlterTable
ALTER TABLE "Court" ADD COLUMN "clubSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Court_clubSessionId_idx" ON "Court"("clubSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Court_clubSessionId_name_key" ON "Court"("clubSessionId", "name");

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
