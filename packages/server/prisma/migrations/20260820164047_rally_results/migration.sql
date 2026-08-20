-- CreateTable
CREATE TABLE "RallyResult" (
    "id" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "hostScore" INTEGER NOT NULL,
    "guestScore" INTEGER NOT NULL,
    "winnerId" TEXT NOT NULL,
    "longestRally" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RallyResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RallyResult_clubSessionId_idx" ON "RallyResult"("clubSessionId");
