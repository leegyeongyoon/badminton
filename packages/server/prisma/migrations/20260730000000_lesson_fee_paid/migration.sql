-- 레슨비 입금확인(운영자 토글)
ALTER TABLE "LessonApplication" ADD COLUMN IF NOT EXISTS "feePaid" BOOLEAN NOT NULL DEFAULT false;
