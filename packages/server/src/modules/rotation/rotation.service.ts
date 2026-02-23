import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { RotationStatus, CourtGameType } from '@badminton/shared';
import type { RotationScheduleResponse, GenerateRotationInput } from '@badminton/shared';
import { generateRotation } from './rotation.algorithm';
import { getIO } from '../../socket';
import { registerTurn } from '../turn/turn.service';
import { logger } from '../../utils/logger';

const MAX_PREFILL_ROUNDS = 2;

export async function generateRotationSchedule(
  facilityId: string,
  userId: string,
  input: GenerateRotationInput,
): Promise<RotationScheduleResponse> {
  // Verify admin or club staff
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId, userId },
  });

  let hasClubPermission = false;
  if (input.clubSessionId) {
    const clubSession = await prisma.clubSession.findUnique({
      where: { id: input.clubSessionId },
    });
    if (clubSession && clubSession.status === 'ACTIVE') {
      const clubMember = await prisma.clubMember.findUnique({
        where: { userId_clubId: { userId, clubId: clubSession.clubId } },
      });
      if (clubMember && (clubMember.role === 'LEADER' || clubMember.role === 'STAFF')) {
        hasClubPermission = true;
      }
    }
  }

  if (!isAdmin && !hasClubPermission) {
    throw new ForbiddenError('관리자 또는 모임 리더/스태프만 로테이션을 생성할 수 있습니다');
  }

  // Get current session
  const session = await prisma.facilitySession.findFirst({
    where: { facilityId, status: 'OPEN' },
  });
  if (!session) throw new BadRequestError('열린 세션이 없습니다');

  // Check no active rotation
  const existing = await prisma.rotationSchedule.findFirst({
    where: { facilityId, status: { in: ['DRAFT', 'ACTIVE'] } },
  });
  if (existing) throw new BadRequestError('이미 진행 중인 로테이션이 있습니다. 먼저 취소하세요.');

  // Get players: either from input or all checked-in available players
  let playerIds: string[];
  if (input.playerIds && input.playerIds.length > 0) {
    playerIds = input.playerIds;
  } else {
    const checkins = await prisma.checkIn.findMany({
      where: { facilityId, checkedOutAt: null, restingAt: null },
      include: {
        user: {
          include: {
            turnPlayers: {
              where: { turn: { status: { in: ['WAITING', 'PLAYING'] } } },
            },
          },
        },
      },
    });
    playerIds = checkins
      .filter((c) => c.user.turnPlayers.length === 0)
      .map((c) => c.userId);
  }

  if (playerIds.length < 4) {
    throw new BadRequestError('최소 4명이 필요합니다');
  }

  // Get courts: either from input or all non-maintenance courts
  let courtIds: string[];
  if (input.courtIds && input.courtIds.length > 0) {
    courtIds = input.courtIds;
  } else {
    const courts = await prisma.court.findMany({
      where: { facilityId, status: { not: 'MAINTENANCE' } },
      orderBy: { name: 'asc' },
    });
    courtIds = courts.map((c) => c.id);
  }

  if (courtIds.length === 0) {
    throw new BadRequestError('사용 가능한 코트가 없습니다');
  }

  // Generate schedule
  const result = generateRotation({
    playerIds,
    courtIds,
    targetRounds: input.targetRounds,
  });

  // Compute per-player stats from the generated slots
  const playerStats = new Map<string, { gamesAssigned: number; sittingOut: number }>();
  for (const pid of playerIds) {
    playerStats.set(pid, { gamesAssigned: 0, sittingOut: 0 });
  }
  for (const slot of result.slots) {
    for (const pid of slot.playerIds) {
      const s = playerStats.get(pid);
      if (s) s.gamesAssigned++;
    }
  }
  // Calculate sitting out per round
  for (let round = 1; round <= result.totalRounds; round++) {
    const playingInRound = new Set<string>();
    for (const slot of result.slots) {
      if (slot.round === round) {
        for (const pid of slot.playerIds) playingInRound.add(pid);
      }
    }
    for (const pid of playerIds) {
      if (!playingInRound.has(pid)) {
        const s = playerStats.get(pid);
        if (s) s.sittingOut++;
      }
    }
  }

  // Save to DB
  const schedule = await prisma.rotationSchedule.create({
    data: {
      facilityId,
      sessionId: session.id,
      createdById: userId,
      clubSessionId: input.clubSessionId ?? null,
      totalRounds: result.totalRounds,
      playerCount: playerIds.length,
      courtCount: courtIds.length,
      slots: {
        create: result.slots.map((s) => ({
          round: s.round,
          courtIndex: s.courtIndex,
          courtId: s.courtId,
          playerIds: s.playerIds,
        })),
      },
      players: {
        create: playerIds.map((pid) => ({
          userId: pid,
          gamesAssigned: playerStats.get(pid)?.gamesAssigned || 0,
          sittingOut: playerStats.get(pid)?.sittingOut || 0,
        })),
      },
    },
  });

  const mapped = await getRotationSchedule(schedule.id);

  const io = getIO();
  io.to(`facility:${facilityId}`).emit('rotation:generated', mapped);

  return mapped;
}

export async function startRotation(
  scheduleId: string,
  userId: string,
): Promise<RotationScheduleResponse> {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
    include: { facility: true },
  });
  if (!schedule) throw new NotFoundError('로테이션');
  if (schedule.status !== 'DRAFT') {
    throw new BadRequestError('DRAFT 상태의 로테이션만 시작할 수 있습니다');
  }

  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId: schedule.facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('관리자만 로테이션을 시작할 수 있습니다');

  // Start the rotation
  await prisma.rotationSchedule.update({
    where: { id: scheduleId },
    data: { status: 'ACTIVE', currentRound: 1, startedAt: new Date() },
  });

  // Materialize first N rounds worth of turns
  await materializeRounds(scheduleId, 1, MAX_PREFILL_ROUNDS);

  const mapped = await getRotationSchedule(scheduleId);

  const io = getIO();
  io.to(`facility:${schedule.facilityId}`).emit('rotation:started', mapped);

  logger.info(`Rotation ${scheduleId} started for facility ${schedule.facilityId}`);

  return mapped;
}

export async function cancelRotation(
  scheduleId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) throw new NotFoundError('로테이션');
  if (!['DRAFT', 'ACTIVE'].includes(schedule.status)) {
    throw new BadRequestError('취소할 수 없는 상태입니다');
  }

  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId: schedule.facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('관리자만 로테이션을 취소할 수 있습니다');

  await prisma.rotationSchedule.update({
    where: { id: scheduleId },
    data: { status: 'CANCELLED' },
  });

  const io = getIO();
  io.to(`facility:${schedule.facilityId}`).emit('rotation:cancelled', { scheduleId });

  return { success: true };
}

export async function regenerateRotation(
  scheduleId: string,
  userId: string,
): Promise<RotationScheduleResponse> {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
    include: { players: true },
  });
  if (!schedule) throw new NotFoundError('로테이션');
  if (schedule.status !== 'DRAFT') {
    throw new BadRequestError('DRAFT 상태에서만 재편성할 수 있습니다');
  }

  // Delete old slots and players
  await prisma.rotationSlot.deleteMany({ where: { scheduleId } });
  await prisma.rotationPlayer.deleteMany({ where: { scheduleId } });

  const playerIds = schedule.players.map((p) => p.userId);

  // Get court IDs from existing slots grouping
  const courts = await prisma.court.findMany({
    where: { facilityId: schedule.facilityId, status: { not: 'MAINTENANCE' } },
    orderBy: { name: 'asc' },
    take: schedule.courtCount,
  });
  const courtIds = courts.map((c) => c.id);

  const result = generateRotation({
    playerIds,
    courtIds,
    targetRounds: schedule.totalRounds,
  });

  // Recompute stats
  const playerStats = new Map<string, { gamesAssigned: number; sittingOut: number }>();
  for (const pid of playerIds) {
    playerStats.set(pid, { gamesAssigned: 0, sittingOut: 0 });
  }
  for (const slot of result.slots) {
    for (const pid of slot.playerIds) {
      const s = playerStats.get(pid);
      if (s) s.gamesAssigned++;
    }
  }
  for (let round = 1; round <= result.totalRounds; round++) {
    const playingInRound = new Set<string>();
    for (const slot of result.slots) {
      if (slot.round === round) {
        for (const pid of slot.playerIds) playingInRound.add(pid);
      }
    }
    for (const pid of playerIds) {
      if (!playingInRound.has(pid)) {
        const s = playerStats.get(pid);
        if (s) s.sittingOut++;
      }
    }
  }

  // Insert new data
  for (const slot of result.slots) {
    await prisma.rotationSlot.create({
      data: {
        scheduleId,
        round: slot.round,
        courtIndex: slot.courtIndex,
        courtId: slot.courtId,
        playerIds: slot.playerIds,
      },
    });
  }
  for (const pid of playerIds) {
    await prisma.rotationPlayer.create({
      data: {
        scheduleId,
        userId: pid,
        gamesAssigned: playerStats.get(pid)?.gamesAssigned || 0,
        sittingOut: playerStats.get(pid)?.sittingOut || 0,
      },
    });
  }

  await prisma.rotationSchedule.update({
    where: { id: scheduleId },
    data: { totalRounds: result.totalRounds },
  });

  return getRotationSchedule(scheduleId);
}

export async function getCurrentRotation(facilityId: string): Promise<RotationScheduleResponse | null> {
  const schedule = await prisma.rotationSchedule.findFirst({
    where: { facilityId, status: { in: ['DRAFT', 'ACTIVE'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!schedule) return null;
  return getRotationSchedule(schedule.id);
}

export async function getRotationSchedule(scheduleId: string): Promise<RotationScheduleResponse> {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      slots: {
        orderBy: [{ round: 'asc' }, { courtIndex: 'asc' }],
        include: { court: true },
      },
      players: {
        include: { user: true },
        orderBy: { gamesAssigned: 'desc' },
      },
    },
  });
  if (!schedule) throw new NotFoundError('로테이션');

  // Build player name lookup
  const playerNames = new Map<string, string>();
  for (const p of schedule.players) {
    playerNames.set(p.userId, p.user.name);
  }

  return {
    id: schedule.id,
    facilityId: schedule.facilityId,
    sessionId: schedule.sessionId,
    status: schedule.status as RotationStatus,
    totalRounds: schedule.totalRounds,
    currentRound: schedule.currentRound,
    playerCount: schedule.playerCount,
    courtCount: schedule.courtCount,
    slots: schedule.slots.map((s) => ({
      id: s.id,
      round: s.round,
      courtIndex: s.courtIndex,
      courtId: s.courtId,
      courtName: s.court.name,
      playerIds: s.playerIds,
      playerNames: s.playerIds.map((pid) => playerNames.get(pid) || pid),
      turnId: s.turnId,
      materialized: s.materialized,
      completed: s.completed,
    })),
    players: schedule.players.map((p) => ({
      userId: p.userId,
      userName: p.user.name,
      gamesAssigned: p.gamesAssigned,
      gamesPlayed: p.gamesPlayed,
      sittingOut: p.sittingOut,
    })),
    createdAt: schedule.createdAt.toISOString(),
    startedAt: schedule.startedAt?.toISOString() ?? null,
    completedAt: schedule.completedAt?.toISOString() ?? null,
  };
}

// --- Materialization: convert RotationSlots into real CourtTurns ---

async function materializeRounds(scheduleId: string, fromRound: number, count: number) {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) return;

  const toRound = Math.min(fromRound + count - 1, schedule.totalRounds);

  const slots = await prisma.rotationSlot.findMany({
    where: {
      scheduleId,
      round: { gte: fromRound, lte: toRound },
      materialized: false,
    },
    orderBy: [{ round: 'asc' }, { courtIndex: 'asc' }],
  });

  for (const slot of slots) {
    try {
      const turn = await registerTurn(
        slot.courtId,
        schedule.createdById,
        slot.playerIds,
        CourtGameType.DOUBLES,
      );

      await prisma.rotationSlot.update({
        where: { id: slot.id },
        data: { materialized: true, turnId: turn.id },
      });
    } catch (err) {
      logger.warn(`Failed to materialize slot ${slot.id} (round ${slot.round}, court ${slot.courtIndex}): ${err}`);
    }
  }
}

/**
 * Called from turn.service.ts completeTurn to refill from rotation.
 * When a turn completes on a court, check if there's a rotation active
 * and materialize the next unmaterialized slot for that court.
 */
export async function maybeRefillFromRotation(courtId: string, facilityId: string) {
  const schedule = await prisma.rotationSchedule.findFirst({
    where: { facilityId, status: 'ACTIVE' },
  });
  if (!schedule) return;

  // Mark the completed slot
  const completedSlot = await prisma.rotationSlot.findFirst({
    where: {
      scheduleId: schedule.id,
      courtId,
      materialized: true,
      completed: false,
    },
    orderBy: { round: 'asc' },
  });
  if (completedSlot) {
    await prisma.rotationSlot.update({
      where: { id: completedSlot.id },
      data: { completed: true },
    });

    // Update player gamesPlayed
    for (const pid of completedSlot.playerIds) {
      await prisma.rotationPlayer.updateMany({
        where: { scheduleId: schedule.id, userId: pid },
        data: { gamesPlayed: { increment: 1 } },
      });
    }
  }

  // Find next unmaterialized slot for this court
  const nextSlot = await prisma.rotationSlot.findFirst({
    where: {
      scheduleId: schedule.id,
      courtId,
      materialized: false,
    },
    orderBy: { round: 'asc' },
  });

  if (nextSlot) {
    try {
      const turn = await registerTurn(
        nextSlot.courtId,
        schedule.createdById,
        nextSlot.playerIds,
        CourtGameType.DOUBLES,
      );
      await prisma.rotationSlot.update({
        where: { id: nextSlot.id },
        data: { materialized: true, turnId: turn.id },
      });
    } catch (err) {
      logger.warn(`Failed to refill from rotation: ${err}`);
    }
  }

  // Check if current round advanced
  await updateRoundProgress(schedule.id);
}

async function updateRoundProgress(scheduleId: string) {
  const schedule = await prisma.rotationSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule || schedule.status !== 'ACTIVE') return;

  // Find the highest round where all slots are completed
  for (let round = schedule.currentRound; round <= schedule.totalRounds; round++) {
    const slotsInRound = await prisma.rotationSlot.findMany({
      where: { scheduleId, round },
    });
    const allCompleted = slotsInRound.every((s) => s.completed);

    if (allCompleted && round > schedule.currentRound) {
      const newRound = Math.min(round + 1, schedule.totalRounds);
      await prisma.rotationSchedule.update({
        where: { id: scheduleId },
        data: { currentRound: newRound },
      });

      const io = getIO();
      io.to(`facility:${schedule.facilityId}`).emit('rotation:roundAdvanced', {
        scheduleId,
        currentRound: newRound,
      });
    }

    if (!allCompleted) break;
  }

  // Check if entire rotation is complete
  const totalSlots = await prisma.rotationSlot.count({ where: { scheduleId } });
  const completedSlots = await prisma.rotationSlot.count({ where: { scheduleId, completed: true } });

  if (completedSlots >= totalSlots) {
    await prisma.rotationSchedule.update({
      where: { id: scheduleId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const io = getIO();
    io.to(`facility:${schedule.facilityId}`).emit('rotation:completed', { scheduleId });

    logger.info(`Rotation ${scheduleId} completed`);
  }
}
