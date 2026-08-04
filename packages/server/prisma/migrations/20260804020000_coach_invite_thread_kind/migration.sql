-- DropIndex
DROP INDEX "CoachThread_coachUserId_userId_key";

-- AlterTable
ALTER TABLE "CoachThread" ADD COLUMN     "jobPostId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'LESSON';

-- CreateTable
CREATE TABLE "CoachJobInvite" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "message" VARCHAR(300),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachJobInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachJobInvite_coachProfileId_createdAt_idx" ON "CoachJobInvite"("coachProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachJobInvite_postId_coachProfileId_key" ON "CoachJobInvite"("postId", "coachProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachThread_coachUserId_userId_kind_key" ON "CoachThread"("coachUserId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "CoachJobInvite" ADD CONSTRAINT "CoachJobInvite_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CoachJobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachJobInvite" ADD CONSTRAINT "CoachJobInvite_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

