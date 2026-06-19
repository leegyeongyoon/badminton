import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { registerJobHandler } from './scheduler.service';

export function registerAllHandlers() {
  // Game time warning handler
  registerJobHandler('game_time_warning', async (turnId: string) => {
    const turn = await prisma.courtTurn.findUnique({
      where: { id: turnId },
      include: {
        court: true,
        players: true,
      },
    });

    if (!turn || turn.status !== 'PLAYING' || !turn.timeLimitAt) return;

    const remainingMs = turn.timeLimitAt.getTime() - Date.now();
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

    const io = getIO();
    io.to(`court:${turn.courtId}`).emit('game:timeWarning', {
      courtId: turn.courtId,
      turnId: turn.id,
      remainingSeconds,
    });
    io.to(`facility:${turn.court.facilityId}`).emit('game:timeWarning', {
      courtId: turn.courtId,
      turnId: turn.id,
      remainingSeconds,
    });

    // Send push to all players
    for (const p of turn.players) {
      await sendPushToUser(p.userId, {
        title: '게임 종료 임박',
        body: `${turn.court.name} 게임 종료 ${Math.ceil(remainingSeconds / 60)}분 전입니다!`,
        data: { courtId: turn.courtId, turnId: turn.id, type: 'game_time_warning' },
      });
    }

    logger.info(`Game time warning sent for turn ${turnId}`);
  });

  // Game time expired handler
  registerJobHandler('game_time_expired', async (turnId: string) => {
    const turn = await prisma.courtTurn.findUnique({
      where: { id: turnId },
      include: {
        court: true,
        players: true,
      },
    });

    if (!turn || turn.status !== 'PLAYING') return;

    const io = getIO();
    io.to(`court:${turn.courtId}`).emit('game:timeExpired', {
      courtId: turn.courtId,
      turnId: turn.id,
    });
    io.to(`facility:${turn.court.facilityId}`).emit('game:timeExpired', {
      courtId: turn.courtId,
      turnId: turn.id,
    });

    // Send push to all players
    for (const p of turn.players) {
      await sendPushToUser(p.userId, {
        title: '게임 시간 종료',
        body: `${turn.court.name} 게임 시간이 종료되었습니다. 코트를 비워주세요.`,
        data: { courtId: turn.courtId, turnId: turn.id, type: 'game_time_expired' },
      });
    }

    logger.info(`Game time expired for turn ${turnId}`);
  });
}
