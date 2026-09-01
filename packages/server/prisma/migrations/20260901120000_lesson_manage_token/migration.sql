-- AlterTable: LessonOffer — 반장용 관리 토큰(무로그인 확인/해제)
ALTER TABLE "LessonOffer" ADD COLUMN "manageToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LessonOffer_manageToken_key" ON "LessonOffer"("manageToken");
