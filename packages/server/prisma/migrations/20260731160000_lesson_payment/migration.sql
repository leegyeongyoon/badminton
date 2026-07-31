-- CreateTable
CREATE TABLE "LessonPayment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "feeAmount" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "pgTxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonPayment_offerId_period_idx" ON "LessonPayment"("offerId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "LessonPayment_applicationId_period_key" ON "LessonPayment"("applicationId", "period");

-- AddForeignKey
ALTER TABLE "LessonPayment" ADD CONSTRAINT "LessonPayment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LessonApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

