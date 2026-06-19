-- AlterTable
ALTER TABLE "GameBoardEntry" ADD COLUMN     "note" TEXT,
ADD COLUMN     "queueOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "GameBoardEntry_boardId_queueOrder_idx" ON "GameBoardEntry"("boardId", "queueOrder");
