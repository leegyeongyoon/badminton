ALTER TABLE "CourtTurn" ADD COLUMN "winnerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "AiCommandLog" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "outcome" TEXT,
    "detail" TEXT,
    "entryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCommandLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiCommandLog_clubId_createdAt_idx" ON "AiCommandLog"("clubId", "createdAt");
CREATE INDEX "AiCommandLog_clubSessionId_idx" ON "AiCommandLog"("clubSessionId");
