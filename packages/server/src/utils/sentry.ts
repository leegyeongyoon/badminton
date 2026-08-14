import * as Sentry from '@sentry/node';

// ── 서버 에러 추적(Sentry) ─────────────────────────────────────
// SENTRY_DSN이 설정된 환경(프로덕션 .env.prod)에서만 활성 — 로컬/CI에선 조용히
// 비활성이라 개발 흐름에 영향 없다. 트레이싱은 끄고(파이 부하 최소화) 에러
// 캡처만 한다. 캡처 지점: errorHandler 500 분기, uncaughtException,
// unhandledRejection. 8/13 장애 때 서버 상태를 원격에서 볼 수 없던 것의 후속.
export const sentryEnabled = !!process.env.SENTRY_DSN;

export function initSentry() {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV || 'production',
  });
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (!sentryEnabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
