-- 운영진 편성 요청(파트너로 같이 N게임 / 같이 안 짜기) — 자동 편성 엔진이 지킨다.
CREATE TABLE "SessionRequest" (
    "id" TEXT NOT NULL,
    "clubSessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "games" INTEGER,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SessionRequest_clubSessionId_idx" ON "SessionRequest"("clubSessionId");
ALTER TABLE "SessionRequest" ADD CONSTRAINT "SessionRequest_clubSessionId_fkey" FOREIGN KEY ("clubSessionId") REFERENCES "ClubSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
