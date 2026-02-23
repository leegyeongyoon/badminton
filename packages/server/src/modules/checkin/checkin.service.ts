import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
import { PlayerStatus, SkillLevel } from '@badminton/shared';
import type { AvailablePlayerResponse, FacilityCapacityResponse } from '@badminton/shared';
import { getIO } from '../../socket';

export async function checkIn(userId: string, qrData: string) {
  const facility = await prisma.facility.findUnique({ where: { qrCodeData: qrData } });
  if (!facility) throw new NotFoundError('시설');

  const existing = await prisma.checkIn.findFirst({
    where: { userId, facilityId: facility.id, checkedOutAt: null },
  });
  if (existing) throw new ConflictError('이미 체크인 상태입니다');

  const checkIn = await prisma.checkIn.create({
    data: { userId, facilityId: facility.id },
    include: { facility: true, user: true },
  });

  const io = getIO();
  io.to(`facility:${facility.id}`).emit('checkin:arrived', {
    userId,
    userName: checkIn.user.name,
    facilityId: facility.id,
  });

  await emitPlayersUpdated(facility.id);

  return {
    id: checkIn.id,
    userId: checkIn.userId,
    facilityId: checkIn.facilityId,
    facilityName: checkIn.facility.name,
    checkedInAt: checkIn.checkedInAt.toISOString(),
  };
}

export async function checkOut(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
  });
  if (!active) throw new BadRequestError('체크인 상태가 아닙니다');

  await prisma.checkIn.update({
    where: { id: active.id },
    data: { checkedOutAt: new Date() },
  });

  const io = getIO();
  io.to(`facility:${active.facilityId}`).emit('checkin:left', {
    userId,
    facilityId: active.facilityId,
  });

  await emitPlayersUpdated(active.facilityId);

  return { success: true };
}

export async function getCheckInStatus(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
    include: { facility: true },
  });

  if (!active) return null;
  return {
    id: active.id,
    userId: active.userId,
    facilityId: active.facilityId,
    facilityName: active.facility.name,
    checkedInAt: active.checkedInAt.toISOString(),
  };
}

export async function getCheckedInUsers(facilityId: string) {
  const checkins = await prisma.checkIn.findMany({
    where: { facilityId, checkedOutAt: null },
    include: { user: true },
    orderBy: { checkedInAt: 'asc' },
  });

  return checkins.map((c) => ({
    userId: c.userId,
    userName: c.user.name,
    checkedInAt: c.checkedInAt.toISOString(),
  }));
}

// --- Phase 2: Rest / Available toggle ---

export async function setResting(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
  });
  if (!active) throw new BadRequestError('체크인 상태가 아닙니다');
  if (active.restingAt) throw new BadRequestError('이미 휴식 중입니다');

  // Check if user is in an active turn
  const inTurn = await prisma.turnPlayer.findFirst({
    where: {
      userId,
      turn: { status: { in: ['WAITING', 'PLAYING'] } },
    },
  });
  if (inTurn) throw new BadRequestError('순번이 있는 동안에는 휴식할 수 없습니다');

  await prisma.checkIn.update({
    where: { id: active.id },
    data: { restingAt: new Date() },
  });

  await emitPlayersUpdated(active.facilityId);

  return { success: true };
}

export async function setAvailable(userId: string) {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
  });
  if (!active) throw new BadRequestError('체크인 상태가 아닙니다');
  if (!active.restingAt) throw new BadRequestError('휴식 상태가 아닙니다');

  await prisma.checkIn.update({
    where: { id: active.id },
    data: { restingAt: null },
  });

  await emitPlayersUpdated(active.facilityId);

  return { success: true };
}

// --- Phase 2: Available Players with status ---

export async function getAvailablePlayers(facilityId: string): Promise<AvailablePlayerResponse[]> {
  const checkins = await prisma.checkIn.findMany({
    where: { facilityId, checkedOutAt: null },
    include: {
      user: {
        include: {
          profile: true,
          turnPlayers: {
            where: {
              turn: { status: { in: ['WAITING', 'PLAYING'] } },
            },
          },
          gamePlayers: {
            where: {
              game: {
                courtId: { not: undefined },
                createdAt: { gte: getStartOfDay() },
                status: { in: ['IN_PROGRESS', 'COMPLETED'] },
              },
            },
          },
        },
      },
    },
    orderBy: { checkedInAt: 'asc' },
  });

  return checkins.map((c) => {
    let status: PlayerStatus;
    if (c.restingAt) {
      status = PlayerStatus.RESTING;
    } else if (c.user.turnPlayers.length > 0) {
      status = PlayerStatus.IN_TURN;
    } else {
      status = PlayerStatus.AVAILABLE;
    }

    return {
      userId: c.userId,
      userName: c.user.name,
      skillLevel: (c.user.profile?.skillLevel || 'INTERMEDIATE') as SkillLevel,
      preferredGameTypes: (c.user.profile?.preferredGameTypes || ['DOUBLES']) as any[],
      gender: c.user.profile?.gender || null,
      checkedInAt: c.checkedInAt.toISOString(),
      gamesPlayedToday: c.user.gamePlayers.length,
      status,
    };
  });
}

// --- Phase 2: Facility Capacity ---

export async function getFacilityCapacity(facilityId: string): Promise<FacilityCapacityResponse> {
  const checkins = await prisma.checkIn.findMany({
    where: { facilityId, checkedOutAt: null },
    include: {
      user: {
        include: {
          turnPlayers: {
            where: {
              turn: { status: { in: ['WAITING', 'PLAYING'] } },
            },
          },
        },
      },
    },
  });

  let availableCount = 0;
  let inTurnCount = 0;
  let restingCount = 0;

  for (const c of checkins) {
    if (c.restingAt) {
      restingCount++;
    } else if (c.user.turnPlayers.length > 0) {
      inTurnCount++;
    } else {
      availableCount++;
    }
  }

  const courts = await prisma.court.findMany({ where: { facilityId } });
  const activeCourts = await prisma.court.count({
    where: { facilityId, status: 'IN_USE' },
  });

  const policy = await prisma.facilityPolicy.findUnique({ where: { facilityId } });
  const maxTurns = policy?.maxTurnsPerCourt ?? 3;
  const totalTurnSlots = courts.length * maxTurns;

  const usedTurnSlots = await prisma.courtTurn.count({
    where: {
      court: { facilityId },
      status: { in: ['WAITING', 'PLAYING'] },
    },
  });

  return {
    totalCheckedIn: checkins.length,
    availableCount,
    inTurnCount,
    restingCount,
    totalCourts: courts.length,
    activeCourts,
    totalTurnSlots,
    usedTurnSlots,
  };
}

// --- Helper: Emit players updated socket event ---

export async function emitPlayersUpdated(facilityId: string) {
  const checkins = await prisma.checkIn.findMany({
    where: { facilityId, checkedOutAt: null },
    include: {
      user: {
        include: {
          turnPlayers: {
            where: {
              turn: { status: { in: ['WAITING', 'PLAYING'] } },
            },
          },
        },
      },
    },
  });

  let availableCount = 0;
  let inTurnCount = 0;
  let restingCount = 0;

  for (const c of checkins) {
    if (c.restingAt) {
      restingCount++;
    } else if (c.user.turnPlayers.length > 0) {
      inTurnCount++;
    } else {
      availableCount++;
    }
  }

  const io = getIO();
  io.to(`facility:${facilityId}`).emit('players:updated', {
    facilityId,
    availableCount,
    inTurnCount,
    restingCount,
  });
}

function getStartOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
