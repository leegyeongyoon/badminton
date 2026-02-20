import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../../utils/errors';
import { CourtStatus, HoldStatus } from '@badminton/shared';
import { transitionCourtStatus } from '../court/court.service';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { logger } from '../../utils/logger';
import { scheduleJob, registerJobHandler, cancelJob } from '../scheduler/scheduler.service';

/**
 * Join queue - supports both individual and club queues.
 * If clubId is provided, it's a club queue entry. Otherwise, it's individual.
 */
export async function joinQueue(courtId: string, userId: string, clubId?: string) {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { facility: { include: { policy: true } } },
  });
  if (!court) throw new NotFoundError('코트');
  if (court.status === 'MAINTENANCE') throw new BadRequestError('점검 중인 코트입니다');

  // Check user is checked in at this facility
  const checkIn = await prisma.checkIn.findFirst({
    where: { userId, facilityId: court.facilityId, checkedOutAt: null },
  });
  if (!checkIn) throw new BadRequestError('체크인 후 이용할 수 있습니다');

  // Check for active penalty
  const activePenalty = await prisma.noShowRecord.findFirst({
    where: {
      userId,
      facilityId: court.facilityId,
      penaltyEndsAt: { gt: new Date() },
    },
  });
  if (activePenalty) {
    throw new BadRequestError('노쇼 패널티 기간 중에는 대기열에 참가할 수 없습니다');
  }

  const isClubQueue = !!clubId;
  const holdType = isClubQueue ? 'CLUB' : 'INDIVIDUAL';

  if (isClubQueue) {
    // Check user belongs to the club
    const membership = await prisma.clubMember.findUnique({
      where: { userId_clubId: { userId, clubId } },
    });
    if (!membership) throw new ForbiddenError('해당 모임의 멤버가 아닙니다');

    // Check hold creation permission
    const policy = court.facility.policy;
    if (policy?.holdCreationMethod === 'ADMIN_ONLY') {
      const isAdmin = await prisma.facilityAdmin.findFirst({
        where: { userId, facilityId: court.facilityId },
      });
      if (!isAdmin) throw new ForbiddenError('관리자만 홀드를 생성할 수 있습니다');
    } else if (policy?.holdCreationMethod === 'CLUB_LEADER') {
      if (!membership.isLeader) {
        const isAdmin = await prisma.facilityAdmin.findFirst({
          where: { userId, facilityId: court.facilityId },
        });
        if (!isAdmin) throw new ForbiddenError('모임 리더 또는 관리자만 홀드를 생성할 수 있습니다');
      }
    }

    // Check if this club already has a hold/queue entry on this court
    const existingHold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        clubId,
        status: { in: ['ACTIVE', 'QUEUED', 'PENDING_ACCEPT'] },
      },
    });
    if (existingHold) throw new ConflictError('이미 이 코트에 대기 중이거나 홀드 중입니다');
  } else {
    // Individual queue - check if user already has a hold on this court
    const existingHold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        userId,
        holdType: 'INDIVIDUAL',
        status: { in: ['ACTIVE', 'QUEUED', 'PENDING_ACCEPT'] },
      },
    });
    if (existingHold) throw new ConflictError('이미 이 코트에 대기 중입니다');
  }

  const io = getIO();

  // If court is EMPTY, create an ACTIVE hold directly
  if (court.status === 'EMPTY') {
    const hold = await prisma.courtHold.create({
      data: {
        courtId,
        clubId: clubId || null,
        userId: isClubQueue ? null : userId,
        holdType,
        createdById: userId,
        status: 'ACTIVE',
        queuePosition: 0,
      },
      include: { club: true, createdBy: true, games: true },
    });

    await transitionCourtStatus(courtId, CourtStatus.HELD);

    const holderName = hold.club?.name || hold.createdBy.name;

    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId,
      status: CourtStatus.HELD,
    });
    io.to(`court:${courtId}`).emit('hold:created', {
      id: hold.id,
      courtId: hold.courtId,
      clubId: hold.clubId || '',
      clubName: hold.club?.name || '',
      createdById: hold.createdById,
      createdByName: hold.createdBy.name,
      status: hold.status as any,
      games: [],
      createdAt: hold.createdAt.toISOString(),
    });

    if (!isClubQueue) {
      io.to(`facility:${court.facilityId}`).emit('queue:individualJoined', {
        courtId,
        userName: hold.createdBy.name,
        position: 0,
      });
    }

    return { hold, queued: false, position: 0 };
  }

  // Court is occupied - join queue
  const policy = court.facility.policy;
  const maxQueue = policy?.maxQueueSize || 5;
  const currentQueueCount = await prisma.courtHold.count({
    where: {
      courtId,
      status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
    },
  });
  if (currentQueueCount >= maxQueue) {
    throw new BadRequestError(`대기열이 가득 찼습니다 (최대 ${maxQueue})`);
  }

  // Calculate next position
  const maxPositionResult = await prisma.courtHold.aggregate({
    where: {
      courtId,
      status: { in: ['ACTIVE', 'QUEUED', 'PENDING_ACCEPT'] },
    },
    _max: { queuePosition: true },
  });
  const nextPosition = (maxPositionResult._max.queuePosition ?? 0) + 1;

  const hold = await prisma.courtHold.create({
    data: {
      courtId,
      clubId: clubId || null,
      userId: isClubQueue ? null : userId,
      holdType,
      createdById: userId,
      status: 'QUEUED',
      queuePosition: nextPosition,
      queuedAt: new Date(),
    },
    include: { club: true, createdBy: true },
  });

  const totalInQueue = currentQueueCount + 1;
  const holderName = hold.club?.name || hold.createdBy.name;

  io.to(`facility:${court.facilityId}`).emit('queue:joined', {
    courtId,
    clubName: holderName,
    position: nextPosition,
    totalInQueue,
  });
  io.to(`court:${courtId}`).emit('queue:joined', {
    courtId,
    clubName: holderName,
    position: nextPosition,
    totalInQueue,
  });

  if (!isClubQueue) {
    io.to(`facility:${court.facilityId}`).emit('queue:individualJoined', {
      courtId,
      userName: hold.createdBy.name,
      position: nextPosition,
    });
  }

  return { hold, queued: true, position: nextPosition };
}

export async function leaveQueue(courtId: string, userId: string, clubId?: string) {
  let hold;

  if (clubId) {
    hold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        clubId,
        status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
      },
      include: { court: { include: { facility: true } } },
    });
  } else {
    hold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        userId,
        holdType: 'INDIVIDUAL',
        status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
      },
      include: { court: { include: { facility: true } } },
    });
  }

  if (!hold) throw new NotFoundError('대기열 항목');

  // Check permission
  if (clubId) {
    const isCreator = hold.createdById === userId;
    const isLeader = await prisma.clubMember.findFirst({
      where: { userId, clubId: hold.clubId!, isLeader: true },
    });
    if (!isCreator && !isLeader) {
      throw new ForbiddenError('대기열을 취소할 권한이 없습니다');
    }
  } else {
    // Individual - must be the user themselves
    if (hold.createdById !== userId) {
      throw new ForbiddenError('대기열을 취소할 권한이 없습니다');
    }
  }

  const removedPosition = hold.queuePosition;

  await prisma.courtHold.update({
    where: { id: hold.id },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  // Cancel any pending scheduled jobs for this hold
  await cancelJob(hold.id, 'QUEUE_ACCEPT_TIMEOUT');

  // Reorder remaining queue entries
  await prisma.courtHold.updateMany({
    where: {
      courtId,
      status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
      queuePosition: { gt: removedPosition },
    },
    data: { queuePosition: { decrement: 1 } },
  });

  const totalInQueue = await prisma.courtHold.count({
    where: {
      courtId,
      status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
    },
  });

  const io = getIO();
  io.to(`facility:${hold.court.facilityId}`).emit('queue:left', {
    courtId,
    clubId: clubId || '',
    totalInQueue,
  });
  io.to(`court:${courtId}`).emit('queue:left', {
    courtId,
    clubId: clubId || '',
    totalInQueue,
  });

  return { success: true };
}

export async function getQueue(courtId: string) {
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');

  const activeHold = await prisma.courtHold.findFirst({
    where: { courtId, status: 'ACTIVE' },
    include: {
      club: true,
      createdBy: true,
      games: {
        orderBy: { order: 'asc' },
        include: { players: { include: { user: true } } },
      },
    },
  });

  const queueEntries = await prisma.courtHold.findMany({
    where: {
      courtId,
      status: { in: ['QUEUED', 'PENDING_ACCEPT'] },
    },
    orderBy: { queuePosition: 'asc' },
    include: { club: true, createdBy: true },
  });

  return {
    courtId,
    courtName: court.name,
    activeHold: activeHold
      ? {
          id: activeHold.id,
          courtId: activeHold.courtId,
          clubId: activeHold.clubId || '',
          clubName: activeHold.club?.name || '',
          createdById: activeHold.createdById,
          createdByName: activeHold.createdBy.name,
          status: activeHold.status,
          games: activeHold.games.map((g) => ({
            id: g.id,
            holdId: g.holdId,
            order: g.order,
            status: g.status,
            players: g.players.map((p) => ({
              id: p.id,
              userId: p.userId,
              userName: p.user.name,
              callStatus: p.callStatus,
            })),
            createdAt: g.createdAt.toISOString(),
          })),
          createdAt: activeHold.createdAt.toISOString(),
        }
      : null,
    queue: queueEntries.map((e) => ({
      holdId: e.id,
      clubId: e.clubId || '',
      clubName: e.club?.name || '',
      userName: e.createdBy.name,
      holdType: e.holdType,
      position: e.queuePosition,
      status: e.status,
      queuedAt: e.queuedAt?.toISOString() || null,
      acceptDeadline: e.acceptDeadline?.toISOString() || null,
    })),
    totalInQueue: queueEntries.length,
  };
}

export async function acceptQueueOffer(courtId: string, userId: string, clubId?: string) {
  let hold;

  if (clubId) {
    hold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        clubId,
        status: 'PENDING_ACCEPT',
      },
      include: { club: true, court: { include: { facility: true } } },
    });
  } else {
    hold = await prisma.courtHold.findFirst({
      where: {
        courtId,
        userId,
        holdType: 'INDIVIDUAL',
        status: 'PENDING_ACCEPT',
      },
      include: { club: true, court: { include: { facility: true } }, createdBy: true },
    });
  }

  if (!hold) throw new NotFoundError('수락 대기 중인 항목이 없습니다');

  // Check deadline
  if (hold.acceptDeadline && new Date() > hold.acceptDeadline) {
    throw new BadRequestError('수락 기한이 지났습니다');
  }

  // Check permission
  if (clubId) {
    const isCreator = hold.createdById === userId;
    const isLeader = await prisma.clubMember.findFirst({
      where: { userId, clubId, isLeader: true },
    });
    if (!isCreator && !isLeader) {
      throw new ForbiddenError('수락 권한이 없습니다');
    }
  } else {
    if (hold.createdById !== userId) {
      throw new ForbiddenError('수락 권한이 없습니다');
    }
  }

  // Cancel the timeout job
  await cancelJob(hold.id, 'QUEUE_ACCEPT_TIMEOUT');

  // Transition to ACTIVE
  await prisma.courtHold.update({
    where: { id: hold.id },
    data: {
      status: 'ACTIVE',
      queuePosition: 0,
      acceptDeadline: null,
    },
  });

  await transitionCourtStatus(courtId, CourtStatus.HELD);

  const holderName = hold.club?.name || (hold as any).createdBy?.name || '';

  const io = getIO();
  io.to(`facility:${hold.court.facilityId}`).emit('court:statusChanged', {
    courtId,
    status: CourtStatus.HELD,
  });
  io.to(`facility:${hold.court.facilityId}`).emit('queue:promoted', {
    courtId,
    clubName: holderName,
    holdId: hold.id,
  });
  io.to(`court:${courtId}`).emit('queue:promoted', {
    courtId,
    clubName: holderName,
    holdId: hold.id,
  });
  io.to(`court:${courtId}`).emit('hold:created', {
    id: hold.id,
    courtId: hold.courtId,
    clubId: hold.clubId || '',
    clubName: hold.club?.name || '',
    createdById: hold.createdById,
    createdByName: (hold as any).createdBy?.name || '',
    status: HoldStatus.ACTIVE,
    games: [],
    createdAt: hold.createdAt.toISOString(),
  });

  return { success: true, holdId: hold.id };
}

export async function promoteNextInQueue(courtId: string) {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { facility: { include: { policy: true } } },
  });
  if (!court) return;

  const nextInQueue = await prisma.courtHold.findFirst({
    where: {
      courtId,
      status: 'QUEUED',
    },
    orderBy: { queuePosition: 'asc' },
    include: { club: true, createdBy: true },
  });

  if (!nextInQueue) {
    // No one in queue, court stays EMPTY
    return;
  }

  const timeoutSeconds = court.facility.policy?.queueAcceptTimeoutSeconds || 120;
  const acceptDeadline = new Date(Date.now() + timeoutSeconds * 1000);

  await prisma.courtHold.update({
    where: { id: nextInQueue.id },
    data: {
      status: 'PENDING_ACCEPT',
      acceptDeadline,
    },
  });

  const holderName = nextInQueue.club?.name || nextInQueue.createdBy.name;
  const io = getIO();

  io.to(`facility:${court.facilityId}`).emit('queue:offerSent', {
    courtId,
    clubName: holderName,
    acceptDeadline: acceptDeadline.toISOString(),
  });
  io.to(`court:${courtId}`).emit('queue:offerSent', {
    courtId,
    clubName: holderName,
    acceptDeadline: acceptDeadline.toISOString(),
  });

  if (nextInQueue.holdType === 'CLUB' && nextInQueue.clubId) {
    // Send push to club leader(s)
    const leaders = await prisma.clubMember.findMany({
      where: { clubId: nextInQueue.clubId, isLeader: true },
    });
    for (const leader of leaders) {
      await sendPushToUser(leader.userId, {
        title: '코트 차례 알림',
        body: `${court.name} 차례입니다. ${timeoutSeconds / 60}분 내 수락하세요!`,
        data: { courtId, type: 'queue_offer' },
      });
      io.to(`user:${leader.userId}`).emit('queue:offerSent', {
        courtId,
        clubName: holderName,
        acceptDeadline: acceptDeadline.toISOString(),
      });
    }
  } else {
    // Individual - send push to the user directly
    await sendPushToUser(nextInQueue.createdById, {
      title: '코트 차례 알림',
      body: `${court.name} 차례입니다. ${timeoutSeconds / 60}분 내 수락하세요!`,
      data: { courtId, type: 'queue_offer' },
    });
    io.to(`user:${nextInQueue.createdById}`).emit('queue:offerSent', {
      courtId,
      clubName: holderName,
      acceptDeadline: acceptDeadline.toISOString(),
    });
  }

  // Schedule persistent timeout for auto-skip
  await scheduleJob('QUEUE_ACCEPT_TIMEOUT', nextInQueue.id, acceptDeadline);
}

export async function handleAcceptTimeout(holdId: string) {
  const hold = await prisma.courtHold.findUnique({
    where: { id: holdId },
    include: { club: true, court: { include: { facility: true } } },
  });
  if (!hold || hold.status !== 'PENDING_ACCEPT') return;

  const courtId = hold.courtId;

  // Skip this hold
  await prisma.courtHold.update({
    where: { id: holdId },
    data: { status: 'SKIPPED', releasedAt: new Date() },
  });

  const io = getIO();
  io.to(`facility:${hold.court.facilityId}`).emit('queue:skipped', {
    courtId,
    clubId: hold.clubId || '',
  });
  io.to(`court:${courtId}`).emit('queue:skipped', {
    courtId,
    clubId: hold.clubId || '',
  });

  // Reorder remaining queue
  await prisma.courtHold.updateMany({
    where: {
      courtId,
      status: 'QUEUED',
      queuePosition: { gt: hold.queuePosition },
    },
    data: { queuePosition: { decrement: 1 } },
  });

  logger.info(`Queue hold ${holdId} skipped due to accept timeout`);

  // Promote next in queue recursively
  await promoteNextInQueue(courtId);
}

// Register scheduler handler
registerJobHandler('QUEUE_ACCEPT_TIMEOUT', async (holdId: string) => {
  await handleAcceptTimeout(holdId);
});
