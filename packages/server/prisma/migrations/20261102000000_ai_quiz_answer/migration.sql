CREATE TABLE "AiQuizAnswer" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "editId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiQuizAnswer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiQuizAnswer_clubId_createdAt_idx" ON "AiQuizAnswer"("clubId", "createdAt");
CREATE INDEX "AiQuizAnswer_editId_idx" ON "AiQuizAnswer"("editId");
