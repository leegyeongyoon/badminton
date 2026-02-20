import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
import { CourtStatus } from '@badminton/shared';
import { transitionCourtStatus } from '../court/court.service';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { logger } from '../../utils/logger';

const SKILL_ORDER = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO'];

export async function joinPool(userId: string, facilityId: string, gameType: string) {
  // Check user is checked in
  const checkIn = await prisma.checkIn.findFirst({
    where: { userId, facilityId, checkedOutAt: null },
  });
  if (!checkIn) throw new BadRequestError('체크인 후 이용할 수 있습니다');

  // Check for active penalty
  const activePenalty = await prisma.noShowRecord.findFirst({
    where: {
      userId,
      facilityId,
      penaltyEndsAt: { gt: new Date() },
    },
  });
  if (activePenalty) {
    throw new BadRequestError('노쇼 패널티 기간 중에는 자동 매칭에 참가할 수 없습니다');
  }

  // Check if already in pool
  const existing = await prisma.autoMatchEntry.findUnique({
    where: { userId_facilityId: { userId, facilityId } },
  });
  if (existing && existing.status === 'WAITING') {
    throw new ConflictError('이미 자동 매칭 대기 중입니다');
  }

  // Upsert entry
  const entry = await prisma.autoMatchEntry.upsert({
    where: { userId_facilityId: { userId, facilityId } },
    create: {
      userId,
      facilityId,
      gameType: gameType as any,
      status: 'WAITING',
    },
    update: {
      gameType: gameType as any,
      status: 'WAITING',
      joinedAt: new Date(),
      matchedAt: null,
    },
  });

  // Emit pool update
  const totalWaiting = await prisma.autoMatchEntry.count({
    where: { facilityId, status: 'WAITING' },
  });
  const io = getIO();
  io.to(`facility:${facilityId}`).emit('automatch:poolUpdated', {
    facilityId,
    totalWaiting,
  });

  // Try to match
  await tryMatch(facilityId, gameType);

  return entry;
}

export async function leavePool(userId: string, facilityId: string) {
  const entry = await prisma.autoMatchEntry.findUnique({
    where: { userId_facilityId: { userId, facilityId } },
  });
  if (!entry || entry.status !== 'WAITING') {
    throw new NotFoundError('자동 매칭 항목');
  }

  await prisma.autoMatchEntry.update({
    where: { id: entry.id },
    data: { status: 'CANCELLED' },
  });

  const totalWaiting = await prisma.autoMatchEntry.count({
    where: { facilityId, status: 'WAITING' },
  });
  const io = getIO();
  io.to(`facility:${facilityId}`).emit('automatch:poolUpdated', {
    facilityId,
    totalWaiting,
  });

  return { success: true };
}

export async function getPool(facilityId: string) {
  const entries = await prisma.autoMatchEntry.findMany({
    where: { facilityId, status: 'WAITING' },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });

  return {
    facilityId,
    entries: entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      userName: e.user.name,
      gameType: e.gameType,
      status: e.status,
      joinedAt: e.joinedAt.toISOString(),
    })),
    totalWaiting: entries.length,
  };
}

async function tryMatch(facilityId: string, gameType: string) {
  const requiredPlayers = gameType === 'SINGLES' ? 2 : 4;

  // Get waiting entries for this game type
  const entries = await prisma.autoMatchEntry.findMany({
    where: {
      facilityId,
      gameType: gameType as any,
      status: 'WAITING',
    },
    include: {
      user: {
        include: { profile: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  if (entries.length < requiredPlayers) return;

  // Simple skill-based matching: group by similar skill levels (±1)
  const sorted = entries.sort((a, b) => {
    const aLevel = SKILL_ORDER.indexOf(a.user.profile?.skillLevel || 'INTERMEDIATE');
    const bLevel = SKILL_ORDER.indexOf(b.user.profile?.skillLevel || 'INTERMEDIATE');
    return aLevel - bLevel;
  });

  // Take the first requiredPlayers that are within ±1 skill of each other
  let matchGroup: typeof sorted = [];
  for (let i = 0; i <= sorted.length - requiredPlayers; i++) {
    const group = sorted.slice(i, i + requiredPlayers);
    const levels = group.map((e) =>
      SKILL_ORDER.indexOf(e.user.profile?.skillLevel || 'INTERMEDIATE'),
    );
    const spread = Math.max(...levels) - Math.min(...levels);
    if (spread <= 1) {
      matchGroup = group;
      break;
    }
  }

  // If no tight match, just take the first N
  if (matchGroup.length === 0) {
    matchGroup = sorted.slice(0, requiredPlayers);
  }

  if (matchGroup.length < requiredPlayers) return;

  const playerIds = matchGroup.map((e) => e.userId);
  const playerNames = matchGroup.map((e) => e.user.name);

  // Mark entries as MATCHED
  await prisma.autoMatchEntry.updateMany({
    where: { id: { in: matchGroup.map((e) => e.id) } },
    data: { status: 'MATCHED', matchedAt: new Date() },
  });

  // Find an empty court
  const emptyCourt = await prisma.court.findFirst({
    where: {
      facilityId,
      status: 'EMPTY',
    },
    include: { facility: true },
  });

  const io = getIO();

  if (emptyCourt) {
    // Create hold and game directly
    const hold = await prisma.courtHold.create({
      data: {
        courtId: emptyCourt.id,
        holdType: 'INDIVIDUAL',
        createdById: playerIds[0],
        userId: playerIds[0],
        status: 'ACTIVE',
        queuePosition: 0,
      },
    });

    await transitionCourtStatus(emptyCourt.id, CourtStatus.HELD);

    const game = await prisma.game.create({
      data: {
        holdId: hold.id,
        order: 1,
        status: 'WAITING',
        players: {
          create: playerIds.map((pid) => ({ userId: pid })),
        },
      },
      include: { players: { include: { user: true } } },
    });

    io.to(`facility:${facilityId}`).emit('court:statusChanged', {
      courtId: emptyCourt.id,
      status: CourtStatus.HELD,
    });

    // Notify all matched players
    for (const pid of playerIds) {
      await sendPushToUser(pid, {
        title: '자동 매칭 완료!',
        body: `${emptyCourt.name}에서 게임이 매칭되었습니다`,
        data: { gameId: game.id, type: 'automatch_matched' },
      });
      io.to(`user:${pid}`).emit('automatch:matched', {
        gameId: game.id,
        courtName: emptyCourt.name,
        players: playerNames,
      });
    }

    logger.info(`AutoMatch: ${requiredPlayers} players matched on ${emptyCourt.name}`);
  } else {
    // No empty court - notify players that they're matched but waiting for court
    for (const pid of playerIds) {
      await sendPushToUser(pid, {
        title: '자동 매칭 완료!',
        body: '매칭되었습니다. 빈 코트가 나면 배정됩니다.',
        data: { type: 'automatch_matched_waiting' },
      });
    }

    logger.info(`AutoMatch: ${requiredPlayers} players matched but no empty court`);
  }

  // Update pool count
  const totalWaiting = await prisma.autoMatchEntry.count({
    where: { facilityId, status: 'WAITING' },
  });
  io.to(`facility:${facilityId}`).emit('automatch:poolUpdated', {
    facilityId,
    totalWaiting,
  });
}
