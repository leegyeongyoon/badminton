-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "monthlyDuesAmount" INTEGER;

-- CreateTable
CREATE TABLE "DuesPayment" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "DuesPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DuesPayment_clubId_period_idx" ON "DuesPayment"("clubId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "DuesPayment_clubId_userId_period_key" ON "DuesPayment"("clubId", "userId", "period");

-- AddForeignKey
ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
