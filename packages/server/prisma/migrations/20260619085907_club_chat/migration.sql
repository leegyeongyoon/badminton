-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('CHAT', 'REQUEST');

-- CreateTable
CREATE TABLE "ClubMessage" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'CHAT',
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubMessage_clubId_createdAt_idx" ON "ClubMessage"("clubId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClubMessage" ADD CONSTRAINT "ClubMessage_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMessage" ADD CONSTRAINT "ClubMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
