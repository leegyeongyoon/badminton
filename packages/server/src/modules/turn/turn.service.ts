import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus, TurnStatus, GameStatus, CourtGameType } from '@badminton/shared';
import type { CourtTurnResponse, CourtDetailResponse } from '@badminton/shared';
import { transitionCourtStatus, getPlayersRequired } from '../court/court.service';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { scheduleJob, cancelJob } from '../scheduler/scheduler.service';
import { emitPlayersUpdated } from '../checkin/checkin.service';
import { verifyClubStaff, isSuperAdmin } from '../clubSession/clubSession.service';

// True when `userId` is LEADER/STAFF of the 정모 that owns this turn — i.e. the
// operator, who may complete/cancel any game on their board.
async function isSessionStaff(clubSessionId: string | null, userId: string): Promise<boolean> {
  if (!clubSessionId) return false;
  const cs = await prisma.clubSession.findUnique({ where: { id: clubSessionId } });
  if (!cs) return false;
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: cs.clubId } },
  });
  return !!member && (member.role === 'LEADER' || member.role === 'STAFF');
}

// 진행 중(PLAYING)인 게임의 선수 1명을 다른 선수로 교체. TurnPlayer + GamePlayer +
// GameBoardEntry.playerIds 를 한 트랜잭션으로 함께 갱신해 셋이 어긋나지 않게 한다.
// 권한·체크인·페널티·다른 코트 PLAYING 충돌을 registerTurn 과 동일하게 검증. 운영판/
// 현황판 갱신용 소켓 emit. (마이그레이션 없음 — 기존 테이블만 갱신)
export async function replacePlayerInRunningTurn(
  turnId: string,
  outUserId: string,
  inUserId: string,
  operatorUserId: string,
): Promise<{ success: true }> {
  if (!inUserId || outUserId === inUserId) throw new BadRequestError('교체할 새 선수를 선택해주세요');
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: { court: true, players: true, game: true },
  });
  if (!turn) throw new NotFoundError('순번');
  if (turn.status !== TurnStatus.PLAYING) throw new BadRequestError('진행 중인 게임만 선수를 교체할 수 있어요');

  const allowed = (await isSessionStaff(turn.clubSessionId, operatorUserId)) || (await isSuperAdmin(operatorUserId));
  if (!allowed) throw new ForbiddenError('대표/운영진만 선수를 교체할 수 있어요');

  if (!turn.players.some((p) => p.userId === outUserId)) throw new BadRequestError('교체할 선수가 이 게임에 없습니다');
  if (turn.players.some((p) => p.userId === inUserId)) throw new BadRequestError('이미 이 게임에 있는 선수예요');

  const court = turn.court;
  const inUser = await prisma.user.findUnique({ where: { id: inUserId }, select: { name: true } });
  const checkin = await prisma.checkIn.findFirst({
    where: { userId: inUserId, facilityId: court.facilityId, checkedOutAt: null },
  });
  if (!checkin) throw new BadRequestError(`${inUser?.name ?? ''}님이 체크인되어 있지 않습니다`);
  if (checkin.isInLesson) throw new BadRequestError(`${inUser?.name ?? ''}님은 레슨 중이라 교체 투입할 수 없어요`);
  const penalty = await prisma.noShowRecord.findFirst({ where: { userId: inUserId, penaltyEndsAt: { gt: new Date() } } });
  if (penalty) throw new BadRequestError(`${inUser?.name ?? ''}님은 페널티 중입니다`);
  if (turn.clubSessionId) {
    const elsewhere = await prisma.courtTurn.findFirst({
      where: { clubSessionId: turn.clubSessionId, status: TurnStatus.PLAYING, courtId: { not: court.id }, players: { some: { userId: inUserId } } },
    });
    if (elsewhere) throw new BadRequestError(`${inUser?.name ?? ''}님이 다른 코트에서 게임 중이에요`);
  }

  const gameId = turn.game?.id ?? null;
  const entry = await prisma.gameBoardEntry.findFirst({ where: { turnId } });
  await prisma.$transaction(async (tx) => {
    await tx.turnPlayer.deleteMany({ where: { turnId, userId: outUserId } });
    await tx.turnPlayer.create({ data: { turnId, userId: inUserId } });
    if (gameId) {
      await tx.gamePlayer.deleteMany({ where: { gameId, userId: outUserId } });
      await tx.gamePlayer.create({ data: { gameId, userId: inUserId } });
    }
    if (entry) {
      await tx.gameBoardEntry.update({
        where: { id: entry.id },
        data: { playerIds: entry.playerIds.map((id) => (id === outUserId ? inUserId : id)) },
      });
    }
  });

  const io = getIO();
  io.to(`facility:${court.facilityId}`).emit('court:statusChanged', { courtId: court.id });
  io.to(`court:${court.id}`).emit('turn:updated', { turnId, courtId: court.id });
  await emitPlayersUpdated(court.facilityId, turn.clubSessionId ?? undefined);
  return { success: true };
}

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

  // BUG-1: resolve the owning 정모 for this turn. The direct route
  // (POST /courts/:courtId/turns) passes no clubSessionId — courts are now
  // per-정모, so derive it from the court so the turn is correctly scoped
  // (never created unscoped/null). The board path already supplies it; keep that.
  const effectiveClubSessionId = clubSessionId ?? court.clubSessionId ?? null;

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
  if (effectiveClubSessionId) {
    const clubSession = await prisma.clubSession.findUnique({
      where: { id: effectiveClubSessionId },
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

  // BUG-2: a court turn / game may have 2 to 4 players regardless of the court's
  // nominal gameType — the operator intentionally drafts partial groups
  // (2 = 단식, 3-4 = 복식/부분 편성). We no longer hard-require exactly 4 for a
  // DOUBLES court; we only enforce the universal 2..4 bound so a 2-3 player
  // QUEUED draft can actually materialize onto a court.
  if (playerIds.length < 2) {
    throw new BadRequestError('2명 이상이어야 코트에 배정할 수 있어요');
  }
  if (playerIds.length > 4) {
    throw new BadRequestError('한 게임에는 최대 4명까지 배정할 수 있어요');
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
    // 레슨 중인 회원은 코트에 배정 불가(하드 제외). 이 가드가 직접/대량/큐→코트/
    // requeue 등 모든 registerTurn 경로를 막는다.
    if (checkin.isInLesson) {
      const user = await prisma.user.findUnique({ where: { id: pid } });
      throw new BadRequestError(`${user?.name ?? pid}님은 레슨 중이라 코트에 배정할 수 없어요`);
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

  // 코트 배정 가드: "게임 중(PLAYING)인 사람은 코트에 배정 차단" (사용자 결정).
  // QUEUE(다음 게임 = addEntry, courtId 없음)에 올리는 건 여전히 SOFT 허용 —
  // 이 가드는 registerTurn(실제 코트 배정/materialize) 경로에서만 동작한다. 한 사람이
  // 동시에 두 코트에서 게임하는 물리적 모순을 막는다. WAITING(대기 줄세우기)이 아니라
  // 지금 '진행 중(PLAYING)'인 경우만 차단 — 게임이 끝나면 배정 가능.
  if (effectiveClubSessionId) {
    const playingElsewhere = await prisma.courtTurn.findMany({
      where: {
        clubSessionId: effectiveClubSessionId,
        status: 'PLAYING',
        courtId: { not: courtId },
        players: { some: { userId: { in: playerIds } } },
      },
      select: {
        players: {
          where: { userId: { in: playerIds } },
          select: { user: { select: { name: true } } },
        },
      },
    });
    if (playingElsewhere.length > 0) {
      const names = [
        ...new Set(
          playingElsewhere.flatMap((t) => t.players.map((p) => p.user?.name ?? '선수')),
        ),
      ];
      throw new BadRequestError(
        `${names.join(', ')}님이 다른 코트에서 게임 중이에요. 게임이 끝난 뒤 배정해 주세요`,
      );
    }
  }

  // A1 (SOFT double-booking, QUEUE only): 큐 등록(addEntry)은 게임 중/대기 중인 사람도
  // 올릴 수 있다(빨간 점 신호만). 위 가드는 코트 '배정' 시점의 PLAYING 충돌만 막는다.
  // 물리적 코트 점유 충돌(한 코트 동시 2턴)은 assignEntry 점유 가드 + 아래 maxTurns로 유지.

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
      clubSessionId: effectiveClubSessionId,
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

  // Notify players — 자동시작(1순번+빈코트)이면 방금 startTurn이 '게임 시작(입장)'
  // 푸시를 이미 보냈으니 '순번 등록'은 생략(중복 방지). 진짜 대기(2순번+)일 때만
  // 순번 안내. (게임판 흐름은 '다음 게임 준비' + '입장' 2개로 충분)
  if (policy?.turnNotifyEnabled !== false && nextPosition > 1) {
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
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  const courtName = court?.name;

  // Court-room broadcast (existing behaviour — operator boards in the court room).
  io.to(`court:${courtId}`).emit('turn:started', { courtId, turnId, courtName, playerIds });

  // ALSO emit to EACH player's user room so the "내 차례" banner fires reliably
  // even though players aren't in the court room. Carries playerIds + courtName so
  // the client can resolve "mine" without relying on a possibly-stale myTurns list.
  for (const pid of playerIds) {
    io.to(`user:${pid}`).emit('turn:started', { courtId, turnId, courtName, playerIds });
  }

  if (court) {
    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId,
      status: CourtStatus.IN_USE,
    });

    // "It's your turn" push: notify every player that the game is starting now.
    // Covers both the position-1 auto-start path and the promotion path.
    if (policy?.turnNotifyEnabled !== false) {
      for (const pid of playerIds) {
        await sendPushToUser(pid, {
          title: `${court.name} 게임 시작`,
          body: `${court.name}으로 입장하세요. 게임이 시작됩니다.`,
          data: { type: 'your_turn', courtId, turnId },
        });
      }
    }
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

// Turn-include shape shared by completeTurn / completeActiveTurnByCourt so the
// core completion logic always sees the same fields (court+facility+policy,
// players, game). Keep both load sites identical.
const COMPLETE_TURN_INCLUDE = {
  players: { include: { user: true } },
  createdBy: true,
  game: true,
  court: { include: { facility: { include: { policy: true } } } },
} as const;

export async function completeTurn(
  turnId: string,
  userId: string,
): Promise<CourtTurnResponse> {
  const turn = await prisma.courtTurn.findUnique({
    where: { id: turnId },
    include: COMPLETE_TURN_INCLUDE,
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
  // The operator (LEADER/STAFF of the turn's 정모) can complete any game on their
  // board — not only ones they created or are playing in.
  const isClubStaff = await isSessionStaff(turn.clubSessionId, userId);
  if (!isPlayer && !isCreator && !isAdmin && !isClubStaff) {
    throw new ForbiddenError('이 순번을 종료할 권한이 없습니다');
  }

  return completeTurnCore(turn);
}

// Core completion logic shared by completeTurn (by turnId, with player/creator
// permission) and completeActiveTurnByCourt (by courtId, with operator/staff
// permission). The CALLER is responsible for authorization and for ensuring the
// turn is PLAYING — this function performs the state changes, board entry
// transition, waiting-turn promotion, sockets/pushes and player-availability
// emit identically for both paths so the game record + your_turn/board sockets
// never drift. `turn` must be loaded with COMPLETE_TURN_INCLUDE.
async function completeTurnCore(turn: any): Promise<CourtTurnResponse> {
  const turnId: string = turn.id;

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

  // The board entry that materialized into this turn is done — transition it so
  // the operator board stops showing the court/players as 게임중 (게임 종료 → 비어있음).
  await prisma.gameBoardEntry.updateMany({
    where: { turnId, status: { in: ['MATERIALIZED', 'PLAYING'] } },
    data: { status: 'COMPLETED' },
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
    // startTurn already sends the "your_turn" push to promoted players,
    // so we no longer send a separate promotion push here (avoids double push).
    await startTurn(nextTurn.id, courtId, nextPlayerIds, turn.court.facilityId);
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

/**
 * 코트 비우기 / 게임 종료 BY COURT — robust, never depends on a client-resolved
 * turnId. Resolves the court's *actually* PLAYING turn server-side and completes
 * it via the SAME completeTurnCore as the normal 게임 종료, then cancels any
 * leftover WAITING turn so the court ends fully empty. This is the stuck-court
 * recovery: even when the client state is desynced, the operator can clear the
 * court and free its players (so the assign guard stops blocking them).
 *
 * Auth: LEADER/STAFF of the court's clubSession OR SUPER_ADMIN — the operator may
 * clear ANY court in their 정모 (does NOT require being a player/creator).
 *
 * Returns the refreshed court/board state (turns still WAITING/PLAYING on the
 * court — empty when fully cleared) plus a flag indicating whether anything was
 * actually cleared.
 */
export async function completeActiveTurnByCourt(
  courtId: string,
  userId: string,
): Promise<CourtDetailResponse & { cleared: boolean }> {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { facility: { include: { policy: true } }, clubSession: true },
  });
  if (!court) throw new NotFoundError('코트');

  // Auth: the court must belong to a 정모; operator (LEADER/STAFF of that 정모) or
  // SUPER_ADMIN may clear it. verifyClubStaff already allows SUPER_ADMIN globally,
  // but a court with no clubSession (facility-level) can only be cleared by an
  // explicit SUPER_ADMIN.
  if (court.clubSessionId) {
    await verifyClubStaff(court.clubSession!.clubId, userId);
  } else if (!(await isSuperAdmin(userId))) {
    throw new ForbiddenError('이 코트를 비울 권한이 없습니다');
  }

  let cleared = false;

  // 1) Cancel any WAITING turn(s) still queued on this court FIRST. A 비우기 must
  //    empty the court, and a queued turn never actually played — so it should be
  //    CANCELLED, not counted as a played game. Cancelling first also means the
  //    PLAYING completion below has nothing to auto-promote, so the court ends
  //    empty in one pass (no promote→complete that would inflate game stats).
  const waitingTurns = await prisma.courtTurn.findMany({
    where: { courtId, status: TurnStatus.WAITING },
    orderBy: { position: 'asc' },
  });
  for (const w of waitingTurns) {
    await cancelStuckWaitingTurn(w, courtId, court.facilityId);
    cleared = true;
  }

  // 2) Complete the court's PLAYING turn (most recent if somehow >1) via the
  //    shared core, so the game record + sockets/pushes stay identical to 게임 종료.
  //    With no WAITING turns left, completeTurnCore transitions the court to EMPTY.
  const playingTurn = await prisma.courtTurn.findFirst({
    where: { courtId, status: TurnStatus.PLAYING },
    orderBy: { startedAt: 'desc' },
    include: COMPLETE_TURN_INCLUDE,
  });
  if (playingTurn) {
    await completeTurnCore(playingTurn);
    cleared = true;
  }

  // 3) Make sure the court itself is EMPTY (completeTurnCore already sets EMPTY
  //    when no waiting turns remain; this is a belt-and-braces no-op otherwise).
  const remaining = await prisma.courtTurn.count({
    where: { courtId, status: { in: [TurnStatus.WAITING, TurnStatus.PLAYING] } },
  });
  if (remaining === 0 && court.status !== CourtStatus.MAINTENANCE) {
    await transitionCourtStatus(courtId, CourtStatus.EMPTY);
    const io = getIO();
    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId,
      status: CourtStatus.EMPTY,
    });
  }

  // Return the refreshed court/board state.
  const detail = await getCourtTurns(courtId);
  return { ...detail, cleared };
}

// Cancel a stuck WAITING turn during a court-clear: mark it CANCELLED, transition
// its board entry, and emit the same cancel/promote sockets as cancelTurn (no
// permission check — the caller of completeActiveTurnByCourt already authorized).
async function cancelStuckWaitingTurn(turn: any, courtId: string, facilityId: string) {
  await prisma.courtTurn.update({
    where: { id: turn.id },
    data: { status: TurnStatus.CANCELLED },
  });
  await prisma.gameBoardEntry.updateMany({
    where: { turnId: turn.id, status: { in: ['MATERIALIZED', 'PLAYING'] } },
    data: { status: 'CANCELLED' },
  });
  const io = getIO();
  io.to(`court:${courtId}`).emit('turn:cancelled', { courtId, turnId: turn.id });
  const allTurns = await getCourtTurnsRaw(courtId);
  io.to(`court:${courtId}`).emit('turn:promoted', { courtId, turns: allTurns });
  await emitPlayersUpdated(facilityId);
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
  const isClubStaff = await isSessionStaff(turn.clubSessionId, userId);
  if (!isPlayer && !isCreator && !isAdmin && !isClubStaff) {
    throw new ForbiddenError('이 순번을 취소할 권한이 없습니다');
  }

  await prisma.courtTurn.update({
    where: { id: turnId },
    data: { status: TurnStatus.CANCELLED },
  });

  // Transition the linked board entry too, so the board clears it (no 유령 게임중).
  await prisma.gameBoardEntry.updateMany({
    where: { turnId, status: { in: ['MATERIALIZED', 'PLAYING'] } },
    data: { status: 'CANCELLED' },
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
