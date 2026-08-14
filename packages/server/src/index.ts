import 'dotenv/config';
import { createServer } from 'http';
import { validateConfig } from './config';
import { logger } from './utils/logger';
import { initSentry, captureError } from './utils/sentry';

// Validate secrets/env BEFORE importing modules that read them or open the DB.
// In production this exits(1) on missing/weak JWT secrets or missing DATABASE_URL.
validateConfig();
initSentry();

import app from './app';
import { startBillingLoop } from './modules/payment/payment.service';
import { startAutoSessionLoop } from './modules/clubSession/autoSession.service';
import { startJobDeadlineLoop } from './modules/coachJob/coachJob.service';
import { initSocketIO } from './socket';
import { prisma } from './utils/prisma';
import { initScheduler, stopScheduler } from './modules/scheduler/scheduler.service';
import { registerAllHandlers } from './modules/scheduler/handlers';
import { initMetrics, stopMetrics, flushMetrics } from './modules/admin/metrics.service';

const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);
initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  registerAllHandlers();
  initScheduler();
  initMetrics();
});

// Last-resort crash handlers. Without these, an uncaught exception or rejected
// promise that escapes a request handler would either kill the process with no
// log line (vanishing on restart) or, for rejections, silently warn. We log it
// to the persisted error file FIRST so the team can know after the fact.
process.on('uncaughtException', (err) => {
  // 이전엔 여기서 process.exit(1)로 프로세스를 죽였다. 하지만 서버는 라즈베리파이 단일
  // 인스턴스라 도커 재시작에 2~3분이 걸려, 정모 도중 '한 번'의 미처리 에러가 접속한
  // 전원을 2~3분씩 끊는 주원인이 됐다. 한 요청/소켓의 에러가 서버 전체를 다운시키지
  // 않도록, 여기서는 로그만 남기고 계속 살아있게 둔다(unhandledRejection과 동일 정책).
  // 대부분의 에러는 Express 전역 에러 미들웨어 + 소켓 핸들러 가드에서 이미 잡히므로,
  // 여기까지 도달하는 건 드물다. (프로세스가 정말 손상됐다면 헬스체크/SIGTERM로 회수.)
  logger.error('uncaughtException (surviving, not exiting)', { err });
  captureError(err, { source: 'uncaughtException' });
});

process.on('unhandledRejection', (reason) => {
  // Log but do NOT exit: an unhandled rejection is less certainly fatal than an
  // uncaught exception, and exiting here would be a denial-of-service vector.
  logger.error('unhandledRejection', { reason });
  captureError(reason, { source: 'unhandledRejection' });
});

// Graceful shutdown with a hard timeout so a hung prisma.$disconnect() (or any
// other slow teardown) can't leave the container stuck and unkillable by the
// orchestrator's normal SIGTERM. Force-exit after 5s.
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down...`);

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 5000);
  forceExit.unref();

  try {
    stopScheduler();
    stopMetrics();
    await flushMetrics(); // 종료 전 마지막 지표 반영(best-effort)
    httpServer.close();
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('error during shutdown', { err });
    clearTimeout(forceExit);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Mock 정기결제 루프(1시간 틱, PAYMENTS_MOCK=1 일 때만 동작).
startBillingLoop();

// 정모 자동 개설·방치 세션 자동 종료 루프(1분 틱, 멱등).
startAutoSessionLoop();

// 코치 공고 마감일 자동 마감 루프(1시간 틱, 멱등).
startJobDeadlineLoop();
