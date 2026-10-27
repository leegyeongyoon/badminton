ALTER TABLE "GameBoardEntry" ADD COLUMN "aiPlayerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "AutoMatchEdit" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "aiPlayerIds" TEXT[],
    "finalPlayerIds" TEXT[],
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoMatchEdit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutoMatchEdit_clubId_createdAt_idx" ON "AutoMatchEdit"("clubId", "createdAt");

CREATE TABLE "GameFeedback" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameFeedback_turnId_userId_key" ON "GameFeedback"("turnId", "userId");
CREATE INDEX "GameFeedback_clubId_createdAt_idx" ON "GameFeedback"("clubId", "createdAt");
