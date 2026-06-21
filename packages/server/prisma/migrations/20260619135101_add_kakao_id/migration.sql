-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kakaoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_kakaoId_key" ON "User"("kakaoId");

