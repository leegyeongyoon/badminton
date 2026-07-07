import { logger } from './logger';

/**
 * Slack Incoming Webhook 으로 운영자(관리자)에게 알림을 보낸다.
 *
 * 용도: 새 운영자 가입 신청처럼 관리자가 바로 확인해야 하는 이벤트를 폰/데스크톱
 * Slack 으로 즉시 받기 위한 것. `SLACK_WEBHOOK_URL` 환경변수가 없으면 조용히 no-op
 * (로컬/시크릿 미설정 환경에서 아무 영향 없음).
 *
 * 알림은 부가 기능이므로 절대 요청 흐름을 막거나 실패시키면 안 된다 — 네트워크 오류나
 * 비정상 응답은 경고 로깅만 하고 삼킨다. 호출부는 `void notifySlack(...)` 로
 * fire-and-forget 하면 된다(이 함수는 reject 하지 않는다).
 */
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      logger.warn(`Slack 알림 실패: HTTP ${res.status}`);
    }
  } catch (err) {
    logger.warn(`Slack 알림 오류: ${(err as Error).message}`);
  }
}
