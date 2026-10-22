-- 자동 편성 팀 구성: 대기 게임의 팀 분할 여부 + 실제 순번 선수의 제안 팀(A/B)
ALTER TABLE "GameBoardEntry" ADD COLUMN "teamSplit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TurnPlayer" ADD COLUMN "team" TEXT;
