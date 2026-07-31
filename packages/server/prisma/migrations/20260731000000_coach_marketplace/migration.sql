-- AlterTable
ALTER TABLE "LessonApplication" ADD COLUMN     "enrollState" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "LessonOffer" ADD COLUMN     "coachProfileId" TEXT;

-- CreateTable
CREATE TABLE "LessonAttendance" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "intro" VARCHAR(200),
    "career" TEXT,
    "regions" TEXT,
    "pricePerMonth" INTEGER,
    "pricePerSession" INTEGER,
    "availableTimes" TEXT,
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachThread" (
    "id" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastText" VARCHAR(200),
    "coachUnread" INTEGER NOT NULL DEFAULT 0,
    "userUnread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromCoach" BOOLEAN NOT NULL,
    "authorName" TEXT NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonAttendance_offerId_date_idx" ON "LessonAttendance"("offerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LessonAttendance_applicationId_date_key" ON "LessonAttendance"("applicationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_key" ON "CoachProfile"("userId");

-- CreateIndex
CREATE INDEX "CoachProfile_active_certified_idx" ON "CoachProfile"("active", "certified");

-- CreateIndex
CREATE INDEX "CoachThread_coachUserId_lastMessageAt_idx" ON "CoachThread"("coachUserId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "CoachThread_userId_lastMessageAt_idx" ON "CoachThread"("userId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachThread_coachUserId_userId_key" ON "CoachThread"("coachUserId", "userId");

-- CreateIndex
CREATE INDEX "CoachMessage_threadId_createdAt_idx" ON "CoachMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "LessonOffer_coachProfileId_idx" ON "LessonOffer"("coachProfileId");

-- AddForeignKey
ALTER TABLE "LessonOffer" ADD CONSTRAINT "LessonOffer_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LessonOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LessonApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachMessage" ADD CONSTRAINT "CoachMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CoachThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

