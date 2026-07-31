-- AlterTable
ALTER TABLE "CoachProfile" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankHolder" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AlterTable
ALTER TABLE "LessonPayment" ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "orderName" TEXT,
ADD COLUMN     "paymentMethodId" TEXT;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "billingKey" TEXT NOT NULL,
    "cardBrand" TEXT NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "cardExpiry" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachPayout" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "feeAmount" INTEGER NOT NULL,
    "payoutAmount" INTEGER NOT NULL,
    "paymentCount" INTEGER NOT NULL,
    "bankSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_billingKey_key" ON "PaymentMethod"("billingKey");

-- CreateIndex
CREATE INDEX "PaymentMethod_userId_isDefault_idx" ON "PaymentMethod"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "CoachPayout_status_period_idx" ON "CoachPayout"("status", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CoachPayout_coachProfileId_period_key" ON "CoachPayout"("coachProfileId", "period");

-- AddForeignKey
ALTER TABLE "LessonPayment" ADD CONSTRAINT "LessonPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachPayout" ADD CONSTRAINT "CoachPayout_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

