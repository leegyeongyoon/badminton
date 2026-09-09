-- CreateTable: 정모 즉석 투표
CREATE TABLE "SessionPoll" (
    "id" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "multi" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SessionPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 투표 응답
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionPoll_clubSessionId_status_idx" ON "SessionPoll"("clubSessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_userId_optionIndex_key" ON "PollVote"("pollId", "userId", "optionIndex");

-- CreateIndex
CREATE INDEX "PollVote_pollId_idx" ON "PollVote"("pollId");

-- AddForeignKey
ALTER TABLE "SessionPoll" ADD CONSTRAINT "SessionPoll_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SessionPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
