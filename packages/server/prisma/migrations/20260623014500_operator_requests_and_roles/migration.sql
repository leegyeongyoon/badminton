-- CreateEnum
CREATE TYPE "OperatorRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "OperatorRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OperatorRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatorRequest_status_idx" ON "OperatorRequest"("status");

-- CreateIndex
CREATE INDEX "OperatorRequest_userId_idx" ON "OperatorRequest"("userId");

-- AddForeignKey
ALTER TABLE "OperatorRequest" ADD CONSTRAINT "OperatorRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
