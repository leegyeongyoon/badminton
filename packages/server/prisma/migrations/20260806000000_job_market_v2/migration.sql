-- AlterTable
ALTER TABLE "CoachJobPost" ADD COLUMN     "deadline" TEXT,
ADD COLUMN     "employmentType" TEXT,
ADD COLUMN     "targetAudience" TEXT,
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CoachJobBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachJobBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachReview" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachJobBookmark_userId_createdAt_idx" ON "CoachJobBookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachJobBookmark_userId_postId_key" ON "CoachJobBookmark"("userId", "postId");

-- CreateIndex
CREATE INDEX "CoachBookmark_userId_createdAt_idx" ON "CoachBookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachBookmark_userId_coachProfileId_key" ON "CoachBookmark"("userId", "coachProfileId");

-- CreateIndex
CREATE INDEX "CoachReview_coachProfileId_createdAt_idx" ON "CoachReview"("coachProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachReview_coachProfileId_authorUserId_key" ON "CoachReview"("coachProfileId", "authorUserId");

-- AddForeignKey
ALTER TABLE "CoachJobBookmark" ADD CONSTRAINT "CoachJobBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CoachJobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachBookmark" ADD CONSTRAINT "CoachBookmark_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachReview" ADD CONSTRAINT "CoachReview_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

