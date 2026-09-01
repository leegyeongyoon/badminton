-- AlterTable: LessonOffer — 무설치 납부 페이지 capability 토큰
ALTER TABLE "LessonOffer" ADD COLUMN "publicToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LessonOffer_publicToken_key" ON "LessonOffer"("publicToken");

-- CreateTable: 레슨비 수동 수납 원장 (월 단위, LessonPayment(카드)와 분리)
CREATE TABLE "LessonFeeRecord" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "reportedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonFeeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonFeeRecord_applicationId_period_key" ON "LessonFeeRecord"("applicationId", "period");

-- CreateIndex
CREATE INDEX "LessonFeeRecord_offerId_period_idx" ON "LessonFeeRecord"("offerId", "period");

-- AddForeignKey
ALTER TABLE "LessonFeeRecord" ADD CONSTRAINT "LessonFeeRecord_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LessonOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonFeeRecord" ADD CONSTRAINT "LessonFeeRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LessonApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
