import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';

const POLL_INTERVAL_MS = 10_000; // 10 seconds

type JobHandler = (targetId: string) => Promise<void>;

const handlers: Record<string, JobHandler> = {};

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers[type] = handler;
}

export async function scheduleJob(type: string, targetId: string, executeAt: Date): Promise<string> {
  const job = await prisma.scheduledJob.create({
    data: { type, targetId, executeAt },
  });
  logger.debug(`Scheduled job ${job.id}: type=${type}, target=${targetId}, at=${executeAt.toISOString()}`);
  return job.id;
}

export async function cancelJob(targetId: string, type?: string) {
  const where: any = { targetId, executed: false };
  if (type) where.type = type;
  await prisma.scheduledJob.updateMany({
    where,
    data: { executed: true },
  });
}

async function processJobs() {
  try {
    const jobs = await prisma.scheduledJob.findMany({
      where: {
        executed: false,
        executeAt: { lte: new Date() },
      },
      orderBy: { executeAt: 'asc' },
      take: 50,
    });

    for (const job of jobs) {
      const handler = handlers[job.type];
      if (!handler) {
        logger.warn(`No handler for job type: ${job.type}`);
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { executed: true },
        });
        continue;
      }

      try {
        await handler(job.targetId);
      } catch (err) {
        logger.error(`Job ${job.id} (${job.type}) failed:`, err);
      }

      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { executed: true },
      });
    }
  } catch (err) {
    logger.error('Scheduler poll error:', err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function initScheduler() {
  logger.info('Initializing scheduler...');

  // Process any overdue jobs immediately on startup
  processJobs().then(() => {
    logger.info('Scheduler: initial overdue job processing complete');
  });

  // Start polling
  intervalId = setInterval(processJobs, POLL_INTERVAL_MS);
  logger.info(`Scheduler started, polling every ${POLL_INTERVAL_MS / 1000}s`);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Scheduler stopped');
  }
}
