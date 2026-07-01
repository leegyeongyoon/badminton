import 'dotenv/config';
import { createServer } from 'http';
import { validateConfig } from './config';
import { logger } from './utils/logger';

// Validate secrets/env BEFORE importing modules that read them or open the DB.
// In production this exits(1) on missing/weak JWT secrets or missing DATABASE_URL.
validateConfig();

import app from './app';
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
  logger.error('uncaughtException', { err });
  // The process is now in an undefined state; the only safe action is to exit
  // and let the restart policy (docker `restart: unless-stopped`) bring up a
  // clean instance. Give winston a moment to flush file transports first.
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', (reason) => {
  // Log but do NOT exit: an unhandled rejection is less certainly fatal than an
  // uncaught exception, and exiting here would be a denial-of-service vector.
  logger.error('unhandledRejection', { reason });
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
