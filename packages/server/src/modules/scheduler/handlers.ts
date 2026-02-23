import { prisma } from '../../utils/prisma';
import { logger } from '../../utils/logger';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { registerJobHandler } from './scheduler.service';
import { RecruitmentStatus } from '@badminton/shared';

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

  // Recruitment expired handler
  registerJobHandler('recruitment_expired', async (recruitmentId: string) => {
    const recruitment = await prisma.groupRecruitment.findUnique({
      where: { id: recruitmentId },
      include: {
        createdBy: true,
        targetCourt: true,
        members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
      },
    });

    if (!recruitment || !['RECRUITING', 'FULL'].includes(recruitment.status)) return;

    await prisma.groupRecruitment.update({
      where: { id: recruitmentId },
      data: { status: RecruitmentStatus.EXPIRED },
    });

    const io = getIO();
    io.to(`facility:${recruitment.facilityId}`).emit('recruitment:cancelled', {
      id: recruitment.id,
      facilityId: recruitment.facilityId,
      createdById: recruitment.createdById,
      createdByName: recruitment.createdBy.name,
      gameType: recruitment.gameType,
      playersRequired: recruitment.playersRequired,
      targetCourtId: recruitment.targetCourtId,
      targetCourtName: recruitment.targetCourt?.name ?? null,
      status: RecruitmentStatus.EXPIRED,
      message: recruitment.message,
      members: recruitment.members.map((m: any) => ({
        userId: m.userId,
        userName: m.user.name,
        joinedAt: m.joinedAt.toISOString(),
      })),
      createdAt: recruitment.createdAt.toISOString(),
      expiresAt: recruitment.expiresAt.toISOString(),
      registeredTurnId: null,
    });

    // Notify creator
    await sendPushToUser(recruitment.createdById, {
      title: '모집 만료',
      body: '모집 시간이 만료되었습니다.',
      data: { recruitmentId: recruitment.id, type: 'recruitment_expired' },
    });

    logger.info(`Recruitment ${recruitmentId} expired`);
  });
}
