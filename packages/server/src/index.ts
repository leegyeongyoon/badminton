import 'dotenv/config';
import { createServer } from 'http';
import app from './app';
import { initSocketIO } from './socket';
import { prisma } from './utils/prisma';
import { logger } from './utils/logger';
import { initScheduler, stopScheduler } from './modules/scheduler/scheduler.service';
import { registerAllHandlers } from './modules/scheduler/handlers';

const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);
initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  registerAllHandlers();
  initScheduler();
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  stopScheduler();
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});
