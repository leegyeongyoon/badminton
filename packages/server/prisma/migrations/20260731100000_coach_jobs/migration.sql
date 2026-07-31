-- CreateTable
CREATE TABLE "CoachCareerEntry" (
    "id" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "org" TEXT,
    "startYm" TEXT,
    "endYm" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachCareerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachJobPost" (
    "id" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "days" JSONB,
    "start" TEXT,
    "end" TEXT,
    "payMonthly" INTEGER,
    "paySession" INTEGER,
    "payNegotiable" BOOLEAN NOT NULL DEFAULT false,
    "region" TEXT NOT NULL,
    "requirements" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachJobPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachJobApplication" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "coachProfileId" TEXT NOT NULL,
    "message" VARCHAR(500),
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachJobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachCareerEntry_coachProfileId_order_idx" ON "CoachCareerEntry"("coachProfileId", "order");

-- CreateIndex
CREATE INDEX "CoachJobPost_status_createdAt_idx" ON "CoachJobPost"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CoachJobPost_authorUserId_idx" ON "CoachJobPost"("authorUserId");

-- CreateIndex
CREATE INDEX "CoachJobPost_clubId_idx" ON "CoachJobPost"("clubId");

-- CreateIndex
CREATE INDEX "CoachJobApplication_coachProfileId_createdAt_idx" ON "CoachJobApplication"("coachProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachJobApplication_postId_coachProfileId_key" ON "CoachJobApplication"("postId", "coachProfileId");

-- AddForeignKey
ALTER TABLE "CoachCareerEntry" ADD CONSTRAINT "CoachCareerEntry_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachJobApplication" ADD CONSTRAINT "CoachJobApplication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CoachJobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachJobApplication" ADD CONSTRAINT "CoachJobApplication_coachProfileId_fkey" FOREIGN KEY ("coachProfileId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

