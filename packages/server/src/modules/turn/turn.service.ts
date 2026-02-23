import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus, TurnStatus, GameStatus, CourtGameType } from '@badminton/shared';
import type { CourtTurnResponse, CourtDetailResponse } from '@badminton/shared';
import { transitionCourtStatus, getPlayersRequired } from '../court/court.service';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { scheduleJob, cancelJob } from '../scheduler/scheduler.service';
import { emitPlayersUpdated } from '../checkin/checkin.service';
import { maybeRefillFromRotation } from '../rotation/rotation.service';

export async function registerTurn(
  courtId: string,
  creatorUserId: string,
  playerIds: string[],
  gameType?: CourtGameType,
  clubSessionId?: string,
): Promise<CourtTurnResponse> {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { facility: { include: { policy: true } } },
  });
  if (!court) throw new NotFoundError('코트');
  if (court.status === CourtStatus.MAINTENANCE) {
    throw new BadRequestError('점검 중인 코트에는 순번을 등록할 수 없습니다');
  }

  // Determine game type and required players
  const effectiveGameType = gameType || (court.gameType as CourtGameType);

  // LESSON courts require admin
  if (effectiveGameType === CourtGameType.LESSON) {
    const isAdmin = await prisma.facilityAdmin.findFirst({
      where: { facilityId: court.facilityId, userId: creatorUserId },
    });
    if (!isAdmin) {
      throw new ForbiddenError('레슨 코트는 관리자만 순번을 등록할 수 있습니다');
    }
  }

  // Club session permission: LEADER/STAFF can register turns for others
  if (clubSessionId) {
    const clubSession = await prisma.clubSession.findUnique({
      where: { id: clubSessionId },
    });
    if (clubSession && clubSession.status === 'ACTIVE') {
      const clubMember = await prisma.clubMember.findUnique({
        where: { userId_clubId: { userId: creatorUserId, clubId: clubSession.clubId } },
      });
      // If club staff, skip the check-in requirement for the creator
      if (clubMember && (clubMember.role === 'LEADER' || clubMember.role === 'STAFF')) {
        // Permission granted - club staff can register turns for others
      }
    }
  }

  const requiredPlayers = effectiveGameType === CourtGameType.DOUBLES ? 4
    : Math.max(2, playerIds.length); // LESSON: flexible, min 2

  if (effectiveGameType === CourtGameType.DOUBLES && playerIds.length !== 4) {
    throw new BadRequestError('복식은 4명이 필요합니다');
  }
  if (playerIds.length < 2) {
    throw new BadRequestError('최소 2명이 필요합니다');
  }

  const policy = court.facility.policy;
  const maxTurns = policy?.maxTurnsPerCourt ?? 3;

  // Check all players are checked in at this facility
  for (const pid of playerIds) {
    const checkin = await prisma.checkIn.findFirst({
      where: { userId: pid, facilityId: court.facilityId, checkedOutAt: null },
    });
    if (!checkin) {
      const user = await prisma.user.findUnique({ where: { id: pid } });
      throw new BadRequestError(`${user?.name ?? pid}님이 체크인되어 있지 않습니다`);
    }
  }

  // Check penalty
  const now = new Date();
  for (const pid of playerIds) {
    const penalty = await prisma.noShowRecord.findFirst({
      where: { userId: pid, penaltyEndsAt: { gt: now } },
    });
    if (penalty) {
      const user = await prisma.user.findUnique({ where: { id: pid } });
      throw new BadRequestError(`${user?.name ?? pid}님은 페널티 중입니다`);
    }
  }

  // Check duplicate: player already in a WAITING or PLAYING turn on this court
  for (const pid of playerIds) {
    const existing = await prisma.turnPlayer.findFirst({
      where: {
        userId: pid,
        turn: {
          courtId,
          status: { in: ['WAITING', 'PLAYING'] },
        },
      },
    });
    if (existing) {
      const user = await prisma.user.findUnique({ where: { id: pid } });
      throw new BadRequestError(`${user?.name ?? pid}님이 이미 이 코트에 순번이 있습니다`);
    }
  }

  // Check max turns
  const activeTurns = await prisma.courtTurn.count({
    where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
  });
  if (activeTurns >= maxTurns) {
    throw new BadRequestError(`순번이 가득 찼습니다 (최대 ${maxTurns})`);
  }

  const nextPosition = activeTurns + 1;

  const turn = await prisma.courtTurn.create({
    data: {
      courtId,
      position: nextPosition,
      gameType: effectiveGameType,
      createdById: creatorUserId,
      clubSessionId: clubSessionId ?? null,
      players: {
        create: playerIds.map((pid) => ({ userId: pid })),
      },
    },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  const mapped = mapTurn(turn);
  const io = getIO();
  io.to(`court:${courtId}`).emit('turn:created', mapped);
  io.to(`facility:${court.facilityId}`).emit('turn:created', mapped);

  // If position 1 and court is EMPTY, auto-start
  if (nextPosition === 1) {
    await startTurn(turn.id, courtId, playerIds, court.facilityId);
  }

  // Notify players
  if (policy?.turnNotifyEnabled !== false) {
    for (const pid of playerIds) {
      await sendPushToUser(pid, {
        title: '순번 등록',
        body: `${court.name} ${nextPosition}순번으로 등록되었습니다`,
        data: { courtId, turnId: turn.id, type: 'turn_registered' },
      });
    }
  }

  // Emit players updated (players are now IN_TURN)
  await emitPlayersUpdated(court.facilityId);

  // Re-fetch to get updated data after possible auto-start
  const updated = await prisma.courtTurn.findUnique({
    where: { id: turn.id },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  return mapTurn(updated!);
}

async function startTurn(turnId: string, courtId: string, playerIds: string[], facilityId: string) {
  // Get policy for timer
  const policy = await prisma.facilityPolicy.findUnique({
    where: { facilityId },
  });

  let timeLimitAt: Date | null = null;
  if (policy?.gameDurationMinutes) {
    timeLimitAt = new Date(Date.now() + policy.gameDurationMinutes * 60 * 1000);
  }

  await prisma.courtTurn.update({
    where: { id: turnId },
    data: {
      status: TurnStatus.PLAYING,
      startedAt: new Date(),
      ...(timeLimitAt && { timeLimitAt }),
    },
  });

  // Create game automatically
  await prisma.game.create({
    data: {
      turnId,
      courtId,
      status: GameStatus.IN_PROGRESS,
      players: {
        create: playerIds.map((pid) => ({ userId: pid })),
      },
    },
  });

  await transitionCourtStatus(courtId, CourtStatus.IN_USE);

  const io = getIO();
  io.to(`court:${courtId}`).emit('turn:started', { courtId, turnId });

  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (court) {
    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId,
      status: CourtStatus.IN_USE,
    });
  }

  // Schedule timer jobs if time limit is set
  if (timeLimitAt && policy) {
    const warningMinutes = policy.gameWarningMinutes ?? 2;
    const warningAt = new Date(timeLimitAt.getTime() - warningMinutes * 60 * 1000);

    if (warningAt > new Date()) {
      await scheduleJob('game_time_warning', turnId, warningAt);
    }
    await scheduleJob('game_time_expired', turnId, timeLimitAt);
  }
}

export async function completeTurn(
  turnId: string,
  userId: string,
): Promise<CourtTurnResponse> {
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: true,
      court: { include: { facility: { include: { policy: true } } } },
    },
  });
  if (!turn) throw new NotFoundError('순번');
  if (turn.status !== TurnStatus.PLAYING) {
    throw new BadRequestError('진행 중인 순번만 종료할 수 있습니다');
  }

  // Permission: creator or facility admin or any player in the turn
  const isPlayer = turn.players.some((p) => p.userId === userId);
  const isCreator = turn.createdById === userId;
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId: turn.court.facilityId, userId },
  });
  if (!isPlayer && !isCreator && !isAdmin) {
    throw new ForbiddenError('이 순번을 종료할 권한이 없습니다');
  }

  // Cancel any scheduled timer jobs
  await cancelJob(turnId, 'game_time_warning');
  await cancelJob(turnId, 'game_time_expired');

  // Complete game
  if (turn.game) {
    await prisma.game.update({
      where: { id: turn.game.id },
      data: { status: GameStatus.COMPLETED },
    });
  }

  // Complete turn
  await prisma.courtTurn.update({
    where: { id: turnId },
    data: { status: TurnStatus.COMPLETED, completedAt: new Date(), timeLimitAt: null },
  });

  const courtId = turn.courtId;

  // Promote waiting turns
  const waitingTurns = await prisma.courtTurn.findMany({
    where: { courtId, status: TurnStatus.WAITING },
    orderBy: { position: 'asc' },
    include: { players: { include: { user: true } } },
  });

  for (let i = 0; i < waitingTurns.length; i++) {
    const newPosition = i + 1;
    if (waitingTurns[i].position !== newPosition) {
      await prisma.courtTurn.update({
        where: { id: waitingTurns[i].id },
        data: { position: newPosition },
      });
    }
  }

  // Auto-start new position 1 if exists
  if (waitingTurns.length > 0) {
    const nextTurn = waitingTurns[0];
    const nextPlayerIds = nextTurn.players.map((p) => p.userId);
    await startTurn(nextTurn.id, courtId, nextPlayerIds, turn.court.facilityId);

    // Notify players of promotion
    const policy = turn.court.facility.policy;
    if (policy?.turnNotifyEnabled !== false) {
      for (const p of nextTurn.players) {
        await sendPushToUser(p.userId, {
          title: '순번 시작',
          body: `${turn.court.name}에서 게임이 시작됩니다!`,
          data: { courtId, turnId: nextTurn.id, type: 'turn_started' },
        });
      }
    }
  } else {
    // No more turns, court becomes empty
    await transitionCourtStatus(courtId, CourtStatus.EMPTY);
  }

  const io = getIO();
  io.to(`court:${courtId}`).emit('turn:completed', { courtId, turnId });
  io.to(`facility:${turn.court.facilityId}`).emit('court:statusChanged', {
    courtId,
    status: waitingTurns.length > 0 ? CourtStatus.IN_USE : CourtStatus.EMPTY,
  });

  // Emit promoted turns list
  const allTurns = await getCourtTurnsRaw(courtId);
  io.to(`court:${courtId}`).emit('turn:promoted', { courtId, turns: allTurns });

  // Emit players updated (players are now AVAILABLE again)
  await emitPlayersUpdated(turn.court.facilityId);

  // Rotation refill: if an active rotation exists, auto-fill next slot
  try {
    await maybeRefillFromRotation(courtId, turn.court.facilityId);
  } catch {
    // Non-critical: don't fail completeTurn if rotation refill fails
  }

  const updated = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  return mapTurn(updated!);
}

export async function cancelTurn(
  turnId: string,
  userId: string,
): Promise<CourtTurnResponse> {
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: true,
      court: true,
    },
  });
  if (!turn) throw new NotFoundError('순번');
  if (turn.status !== TurnStatus.WAITING) {
    throw new BadRequestError('대기 중인 순번만 취소할 수 있습니다');
  }

  // Permission: creator or facility admin or any player
  const isPlayer = turn.players.some((p) => p.userId === userId);
  const isCreator = turn.createdById === userId;
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId: turn.court.facilityId, userId },
  });
  if (!isPlayer && !isCreator && !isAdmin) {
    throw new ForbiddenError('이 순번을 취소할 권한이 없습니다');
  }

  await prisma.courtTurn.update({
    where: { id: turnId },
    data: { status: TurnStatus.CANCELLED },
  });

  // Reorder remaining waiting turns
  const courtId = turn.courtId;
  const remainingTurns = await prisma.courtTurn.findMany({
    where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
    orderBy: { position: 'asc' },
  });

  for (let i = 0; i < remainingTurns.length; i++) {
    const newPosition = i + 1;
    if (remainingTurns[i].position !== newPosition) {
      await prisma.courtTurn.update({
        where: { id: remainingTurns[i].id },
        data: { position: newPosition },
      });
    }
  }

  const io = getIO();
  io.to(`court:${courtId}`).emit('turn:cancelled', { courtId, turnId });

  const allTurns = await getCourtTurnsRaw(courtId);
  io.to(`court:${courtId}`).emit('turn:promoted', { courtId, turns: allTurns });

  // Emit players updated
  await emitPlayersUpdated(turn.court.facilityId);

  const updated = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  return mapTurn(updated!);
}

export async function requeueTurn(
  turnId: string,
  userId: string,
  options?: { newPlayerIds?: string[]; targetCourtId?: string },
): Promise<CourtTurnResponse> {
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      court: { include: { facility: { include: { policy: true } } } },
    },
  });
  if (!turn) throw new NotFoundError('순번');
  if (turn.status !== TurnStatus.COMPLETED) {
    throw new BadRequestError('완료된 순번만 다시 줄설 수 있습니다');
  }

  const policy = turn.court.facility.policy;
  if (policy?.allowRequeue === false) {
    throw new BadRequestError('이 시설은 재대기를 허용하지 않습니다');
  }

  const playerIds = options?.newPlayerIds || turn.players.map((p) => p.userId);
  const targetCourtId = options?.targetCourtId || turn.courtId;

  return registerTurn(targetCourtId, userId, playerIds, turn.gameType as CourtGameType);
}

export async function extendTurn(
  turnId: string,
  userId: string,
  minutes: number,
): Promise<CourtTurnResponse> {
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      court: { include: { facility: true } },
    },
  });
  if (!turn) throw new NotFoundError('순번');
  if (turn.status !== TurnStatus.PLAYING) {
    throw new BadRequestError('진행 중인 순번만 연장할 수 있습니다');
  }

  // Only admin can extend
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId: turn.court.facilityId, userId },
  });
  if (!isAdmin) {
    throw new ForbiddenError('관리자만 시간을 연장할 수 있습니다');
  }

  // Cancel existing timer jobs
  await cancelJob(turnId, 'game_time_warning');
  await cancelJob(turnId, 'game_time_expired');

  const baseTime = turn.timeLimitAt || new Date();
  const newTimeLimitAt = new Date(baseTime.getTime() + minutes * 60 * 1000);

  await prisma.courtTurn.update({
    where: { id: turnId },
    data: { timeLimitAt: newTimeLimitAt },
  });

  // Schedule new timer jobs
  const policy = await prisma.facilityPolicy.findUnique({
    where: { facilityId: turn.court.facilityId },
  });
  const warningMinutes = policy?.gameWarningMinutes ?? 2;
  const warningAt = new Date(newTimeLimitAt.getTime() - warningMinutes * 60 * 1000);
  if (warningAt > new Date()) {
    await scheduleJob('game_time_warning', turnId, warningAt);
  }
  await scheduleJob('game_time_expired', turnId, newTimeLimitAt);

  const updated = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  return mapTurn(updated!);
}

export async function getCourtTurns(courtId: string): Promise<CourtDetailResponse> {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { facility: { include: { policy: true } } },
  });
  if (!court) throw new NotFoundError('코트');

  const turns = await getCourtTurnsRaw(courtId);
  const maxTurns = court.facility.policy?.maxTurnsPerCourt ?? 3;

  return {
    court: {
      id: court.id,
      name: court.name,
      facilityId: court.facilityId,
      status: court.status as any,
      gameType: court.gameType as any,
      playersRequired: getPlayersRequired(court.gameType as CourtGameType),
    },
    turns,
    maxTurns,
  };
}

async function getCourtTurnsRaw(courtId: string): Promise<CourtTurnResponse[]> {
  const turns = await prisma.courtTurn.findMany({
    where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
    orderBy: { position: 'asc' },
    include: {
      players: { include: { user: true } },
      createdBy: true,
      game: { include: { players: { include: { user: true } } } },
      clubSession: { include: { club: true } },
    },
  });

  return turns.map(mapTurn);
}

export async function getMyTurns(userId: string) {
  const turnPlayers = await prisma.turnPlayer.findMany({
    where: {
      userId,
      turn: { status: { in: ['WAITING', 'PLAYING'] } },
    },
    include: {
      turn: {
        include: {
          court: true,
          players: { include: { user: true } },
        },
      },
    },
  });

  return turnPlayers.map((tp) => ({
    turnId: tp.turn.id,
    courtName: tp.turn.court.name,
    position: tp.turn.position,
    status: tp.turn.status,
    gameType: tp.turn.gameType,
    players: tp.turn.players.map((p) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
    })),
    timeLimitAt: tp.turn.timeLimitAt?.toISOString() ?? null,
  }));
}

function mapTurn(turn: any): CourtTurnResponse {
  return {
    id: turn.id,
    courtId: turn.courtId,
    position: turn.position,
    status: turn.status,
    gameType: turn.gameType,
    createdById: turn.createdById,
    createdByName: turn.createdBy.name,
    players: turn.players.map((p: any) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
    })),
    game: turn.game
      ? {
          id: turn.game.id,
          turnId: turn.game.turnId,
          courtId: turn.game.courtId,
          status: turn.game.status,
          players: turn.game.players?.map((p: any) => ({
            id: p.id,
            userId: p.userId,
            userName: p.user.name,
          })) ?? [],
          createdAt: turn.game.createdAt.toISOString(),
        }
      : null,
    clubSessionId: turn.clubSessionId ?? null,
    clubName: turn.clubSession?.club?.name ?? null,
    createdAt: turn.createdAt.toISOString(),
    startedAt: turn.startedAt?.toISOString() ?? null,
    completedAt: turn.completedAt?.toISOString() ?? null,
    timeLimitAt: turn.timeLimitAt?.toISOString() ?? null,
  };
}
