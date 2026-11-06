-- 그림자(SHADOW) 기록을 운영진이 판을 '등록한 순간'에 남기고, 코트에 넣을 때 최종 4명으로 갱신하려고 대기 게임 id를 함께 둔다.
ALTER TABLE "AutoMatchEdit" ADD COLUMN IF NOT EXISTS "entryId" TEXT;
CREATE INDEX IF NOT EXISTS "AutoMatchEdit_entryId_idx" ON "AutoMatchEdit"("entryId");
