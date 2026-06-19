import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket';
import { registerTurn } from '../turn/turn.service';
import { sendPushToUser } from '../notification/notification.service';
import { generateRotation } from './suggest.algorithm';

export async function createGameBoard(clubSessionId: string, userId: string) {
  const clubSession = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    include: { club: true },
  });
  if (!clubSession) throw new NotFoundError('클럽 세션');
  if (clubSession.status !== 'ACTIVE') throw new BadRequestError('활성 세션에서만 모임판을 생성할 수 있습니다');

  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: clubSession.clubId } },
  });
  if (!member || member.role === 'MEMBER') {
    throw new ForbiddenError('모임판은 대표/운영진만 생성할 수 있습니다');
  }

  const existing = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { orderBy: { position: 'asc' } } },
  });
  if (existing) return formatBoard(existing);

  const board = await prisma.gameBoard.create({
    data: {
      clubSessionId,
      facilityId: clubSession.facilityId,
      createdById: userId,
    },
    include: { entries: true },
  });

  return formatBoard(board);
}

export async function getGameBoard(clubSessionId: string) {
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: {
      // Court-less QUEUED entries ordered by the global queueOrder (다음 게임 순서);
      // on-court / materialized entries keep their createdAt order. formatBoard
      // re-sorts so QUEUED come first by queueOrder, then the rest by createdAt.
      entries: { orderBy: [{ queueOrder: 'asc' }, { position: 'asc' }] },
    },
  });
  if (!board) throw new NotFoundError('모임판');
  return formatBoard(board);
}

// addEntry: courtId is optional (대기 먼저, 코트는 나중에)
export async function addEntry(
  boardId: string,
  playerIds: string[],
  userId: string,
  courtId?: string,
  note?: string,
) {
  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: { entries: { where: { status: 'QUEUED' } } },
  });
  if (!board) throw new NotFoundError('모임판');

  const nextPosition = board.entries.length + 1;
  // Append to the end of the global queue.
  const maxOrder = board.entries.reduce((m, e) => Math.max(m, e.queueOrder), 0);

  const entry = await prisma.gameBoardEntry.create({
    data: {
      boardId,
      courtId: courtId || null,
      position: nextPosition,
      queueOrder: maxOrder + 1,
      note: note ?? null,
      playerIds,
      status: 'QUEUED',
    },
  });

  const formatted = await formatEntry(entry);

  const io = getIO();
  io.to(`facility:${board.facilityId}`).emit('gameBoard:entryAdded', formatted);

  // Notify assigned players
  for (const playerId of playerIds) {
    if (playerId !== userId) {
      const otherNames = await getPlayerNames(playerIds.filter((id) => id !== playerId));
      await sendPushToUser(playerId, {
        title: '게임 편성됨',
        body: `대기 ${nextPosition}번, ${otherNames.join('/')}와 함께`,
        data: { type: 'gameBoard', boardId },
      });
    }
  }

  return formatted;
}

// Permission helper: a board belongs to a club session; only that club's
// LEADER/STAFF may operate the queue. Returns the board (with clubSession).
async function verifyBoardStaff(boardId: string, userId: string) {
  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: { clubSession: true },
  });
  if (!board) throw new NotFoundError('모임판');
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: board.clubSession.clubId } },
  });
  if (!member || member.role === 'MEMBER') {
    throw new ForbiddenError('큐는 대표/운영진만 관리할 수 있습니다');
  }
  return board;
}

// createQueueGame: court-less QUEUED game appended to the end of the global queue.
// playerIds: 2 or 4. LEADER/STAFF only.
export async function createQueueGame(
  boardId: string,
  playerIds: string[],
  userId: string,
  note?: string,
) {
  await verifyBoardStaff(boardId, userId);
  // courtId omitted → court-less queued entry (assigned later via assignEntry).
  return addEntry(boardId, playerIds, userId, undefined, note);
}

// reorderQueue: set queueOrder for the QUEUED entries to match the given full order.
// entryIds must be exactly the set of QUEUED entries on this board. LEADER/STAFF only.
export async function reorderQueue(boardId: string, entryIds: string[], userId: string) {
  const board = await verifyBoardStaff(boardId, userId);

  const queued = await prisma.gameBoardEntry.findMany({
    where: { boardId, status: 'QUEUED' },
    select: { id: true },
  });
  const queuedIds = new Set(queued.map((e) => e.id));

  if (entryIds.length !== queuedIds.size) {
    throw new BadRequestError('대기 중인 모든 게임을 순서대로 보내야 합니다');
  }
  for (const id of entryIds) {
    if (!queuedIds.has(id)) {
      throw new BadRequestError('대기 중이지 않은 게임이 포함되어 있습니다');
    }
  }

  await prisma.$transaction(
    entryIds.map((id, idx) =>
      prisma.gameBoardEntry.update({
        where: { id },
        data: { queueOrder: idx + 1, position: idx + 1 },
      }),
    ),
  );

  const io = getIO();
  io.to(`facility:${board.facilityId}`).emit('gameBoard:reordered', { boardId, entryIds });

  return getGameBoard(board.clubSessionId);
}

// assignEntry: assign a QUEUED entry to a specific (EMPTY) court and materialize it.
// Reuses pushEntry → registerTurn → startTurn so the your_turn push + sockets fire.
// Rejects if the court is occupied (IN_USE) or under maintenance.
export async function assignEntry(
  boardId: string,
  entryId: string,
  courtId: string,
  userId: string,
) {
  await verifyBoardStaff(boardId, userId);

  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');
  if (court.status === 'MAINTENANCE') {
    throw new BadRequestError('점검 중(사용 불가)인 코트에는 배정할 수 없습니다');
  }
  // Reject assigning onto an occupied court (an active turn/game is already there).
  const occupied = await prisma.courtTurn.findFirst({
    where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
  });
  if (occupied) {
    throw new BadRequestError('이미 사용 중인 코트입니다. 빈 코트에 배정하세요');
  }

  return pushEntry(boardId, entryId, courtId, userId);
}

export async function updateEntry(boardId: string, entryId: string, playerIds: string[]) {
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 수정할 수 있습니다');

  const updated = await prisma.gameBoardEntry.update({
    where: { id: entryId },
    data: { playerIds },
  });

  const formatted = await formatEntry(updated);
  const board = await prisma.gameBoard.findUnique({ where: { id: boardId } });
  if (board) {
    const io = getIO();
    io.to(`facility:${board.facilityId}`).emit('gameBoard:entryUpdated', formatted);
  }

  return formatted;
}

export async function deleteEntry(boardId: string, entryId: string) {
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 삭제할 수 있습니다');

  await prisma.gameBoardEntry.delete({ where: { id: entryId } });

  // Reorder positions for remaining QUEUED entries
  const remaining = await prisma.gameBoardEntry.findMany({
    where: { boardId, status: 'QUEUED' },
    orderBy: { position: 'asc' },
  });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position !== i + 1) {
      await prisma.gameBoardEntry.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      });
    }
  }

  const board = await prisma.gameBoard.findUnique({ where: { id: boardId } });
  if (board) {
    const io = getIO();
    io.to(`facility:${board.facilityId}`).emit('gameBoard:entryRemoved', { entryId, boardId });
  }
}

// pushEntry: 대기 게임을 특정 코트에 걸기 (courtId 필수)
export async function pushEntry(boardId: string, entryId: string, courtId: string, userId: string) {
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 코트에 걸 수 있습니다');

  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: { clubSession: true },
  });
  if (!board) throw new NotFoundError('모임판');

  // Use existing registerTurn to create CourtTurn
  const turn = await registerTurn(
    courtId,
    userId,
    entry.playerIds,
    undefined,
    board.clubSessionId,
  );

  // Update entry: assign court + change status
  const updated = await prisma.gameBoardEntry.update({
    where: { id: entryId },
    data: { status: 'MATERIALIZED', turnId: turn.id, courtId },
  });

  const formatted = await formatEntry(updated);
  const io = getIO();
  io.to(`facility:${board.facilityId}`).emit('gameBoard:entryPushed', formatted);

  // Notify players
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  for (const playerId of entry.playerIds) {
    await sendPushToUser(playerId, {
      title: '다음 게임 준비',
      body: `${court?.name || '코트'}에서 곧 시작합니다`,
      data: { type: 'gameBoard', courtId },
    });
  }

  return formatted;
}

export async function pushAllEntries(boardId: string, userId: string) {
  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: {
      entries: { where: { status: 'QUEUED' }, orderBy: { position: 'asc' } },
    },
  });
  if (!board) throw new NotFoundError('모임판');

  // Get available courts
  const courts = await prisma.court.findMany({
    where: { facilityId: board.facilityId, status: { not: 'MAINTENANCE' } },
    orderBy: { name: 'asc' },
  });

  const results = [];
  let courtIdx = 0;
  for (const entry of board.entries) {
    if (courtIdx >= courts.length) break;
    try {
      const result = await pushEntry(boardId, entry.id, courts[courtIdx].id, userId);
      results.push(result);
      courtIdx++;
    } catch (e) {
      console.warn(`pushAllEntries: skipped entry ${entry.id}:`, e);
      courtIdx++; // Try next court
    }
  }
  return results;
}

// suggestNextFoursome: read-only auto-suggestion of next game(s) for a club session.
// Does NOT mutate any state.
export async function suggestNextFoursome(
  clubSessionId: string,
  opts: { courtId?: string; count?: number },
  userId: string,
) {
  const clubSession = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
  });
  if (!clubSession) throw new NotFoundError('클럽 세션');
  if (clubSession.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션에서만 추천할 수 있습니다');
  }

  // Permission: LEADER/STAFF only (mirror createGameBoard pattern)
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: clubSession.clubId } },
  });
  if (!member || member.role === 'MEMBER') {
    throw new ForbiddenError('자동 편성은 대표/운영진만 가능합니다');
  }

  const now = new Date();
  const count = opts.count ?? 1;

  // Active check-ins for this club session
  const checkins = await prisma.checkIn.findMany({
    where: { clubSessionId, checkedOutAt: null },
    select: { userId: true, restingAt: true },
  });

  // Exclusion sets ------------------------------------------------------------
  // Resting users
  const restingIds = new Set(checkins.filter((c) => c.restingAt).map((c) => c.userId));

  // Users currently in a WAITING/PLAYING turn
  const inTurn = await prisma.turnPlayer.findMany({
    where: { turn: { status: { in: ['WAITING', 'PLAYING'] } } },
    select: { userId: true },
  });
  const inTurnIds = new Set(inTurn.map((t) => t.userId));

  // Users already in a QUEUED GameBoardEntry on this board
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { where: { status: 'QUEUED' }, select: { playerIds: true } } },
  });
  const queuedIds = new Set<string>();
  for (const e of board?.entries ?? []) {
    for (const pid of e.playerIds) queuedIds.add(pid);
  }

  // Penalized users (active NoShow penalty)
  const penalties = await prisma.noShowRecord.findMany({
    where: { penaltyEndsAt: { gt: now } },
    select: { userId: true },
  });
  const penalizedIds = new Set(penalties.map((p) => p.userId));

  // Build eligible pool --------------------------------------------------------
  const poolIds = checkins
    .map((c) => c.userId)
    .filter(
      (id) =>
        !restingIds.has(id) &&
        !inTurnIds.has(id) &&
        !queuedIds.has(id) &&
        !penalizedIds.has(id),
    );

  if (poolIds.length < 4) {
    return { suggestions: [] };
  }

  // initialGamesCount: games already played this session per pool user.
  // A "game played this session" = a GamePlayer row whose Game's CourtTurn
  // belongs to this clubSession.
  const gamePlayers = await prisma.gamePlayer.findMany({
    where: {
      userId: { in: poolIds },
      game: { turn: { clubSessionId } },
    },
    select: { userId: true },
  });
  const initialGamesCount: Record<string, number> = {};
  for (const pid of poolIds) initialGamesCount[pid] = 0;
  for (const gp of gamePlayers) {
    initialGamesCount[gp.userId] = (initialGamesCount[gp.userId] ?? 0) + 1;
  }

  // Generate rotation. The algorithm fills courts of 4; we request `count` rounds
  // on a single (virtual or real) court and take the first `count` slots.
  const rotation = generateRotation({
    playerIds: poolIds,
    courtIds: [opts.courtId ?? 'virtual'],
    targetRounds: count,
    initialGamesCount,
  });

  const slots = rotation.slots.slice(0, count);

  // Resolve player names
  const allIds = Array.from(new Set(slots.flatMap((s) => s.playerIds)));
  const users = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(users.map((u) => [u.id, u.name]));

  const suggestions = slots.map((s) => ({
    playerIds: s.playerIds,
    playerNames: s.playerIds.map((id) => nameMap.get(id) ?? ''),
  }));

  return { suggestions };
}

// ─── Helpers ────────────────────────────────

async function formatBoard(board: any) {
  const rawEntries: any[] = board.entries || [];

  // Order: QUEUED entries first by queueOrder (the global "다음 게임" order),
  // then the on-court / materialized / done entries by createdAt.
  const sorted = [...rawEntries].sort((a, b) => {
    const aQ = a.status === 'QUEUED';
    const bQ = b.status === 'QUEUED';
    if (aQ && bQ) return a.queueOrder - b.queueOrder;
    if (aQ) return -1;
    if (bQ) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const entries = await Promise.all(sorted.map((e) => formatEntry(e)));

  const composition = await computeComposition(board.clubSessionId, rawEntries);

  return {
    id: board.id,
    clubSessionId: board.clubSessionId,
    facilityId: board.facilityId,
    createdById: board.createdById,
    createdAt: board.createdAt.toISOString(),
    entries,
    busyPlayerIds: await computeBusyPlayerIds(board.clubSessionId, rawEntries),
    playedGroups: composition.playedGroups,
    pairCounts: composition.pairCounts,
  };
}

// Composition-aid data for THIS 정모 used by the client to flag repeat foursomes
// ("이미 친 조합") and over-paired players when staging the next game.
//   - playedGroups: sorted-and-joined keys ("a|b|c|d") of 4-player groups that
//     ALREADY occurred this session (a completed/playing game). QUEUED foursomes
//     are also keyed so the client can flag a staged group that was already played.
//   - pairCounts: "<minUserId>|<maxUserId>" -> # of games the two shared this
//     session (count >= 1 only). Derived from COMPLETED + PLAYING games and the
//     pairings implied by QUEUED entries' playerIds.
async function computeComposition(
  clubSessionId: string,
  rawEntries: any[],
): Promise<{ playedGroups: string[]; pairCounts: Record<string, number> }> {
  // Games actually played this 정모 (COMPLETED + currently PLAYING).
  const games = await prisma.game.findMany({
    where: {
      turn: { clubSessionId },
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
    },
    select: { players: { select: { userId: true } } },
  });

  const playedGroupSet = new Set<string>();
  const pairCounts = new Map<string, number>();

  const addPairs = (ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  };

  for (const game of games) {
    const ids = game.players.map((p) => p.userId);
    if (ids.length === 4) {
      playedGroupSet.add([...ids].sort().join('|'));
    }
    addPairs(ids);
  }

  // QUEUED entries: their playerIds also count for the staged "이미 친 조합" check
  // and pairing visibility (they will be played next).
  for (const e of rawEntries) {
    if (e.status !== 'QUEUED') continue;
    const ids = (e.playerIds as string[]) ?? [];
    if (ids.length === 4) {
      playedGroupSet.add([...ids].sort().join('|'));
    }
    addPairs(ids);
  }

  return {
    playedGroups: Array.from(playedGroupSet),
    pairCounts: Object.fromEntries(pairCounts),
  };
}

// SOFT double-booking data: userIds who are (a) currently in a WAITING/PLAYING
// turn WITHIN THIS 정모 (clubSession), or (b) appear in more than one QUEUED entry
// on this board. Used by the client to flag (small red dot) double-booked players.
// SESSION-scoped on purpose: a player busy in a DIFFERENT 정모 at the same gym is
// not a conflict here. Never a hard block.
async function computeBusyPlayerIds(clubSessionId: string, rawEntries: any[]): Promise<string[]> {
  const busy = new Set<string>();

  // (a) Currently playing / queued in a court turn OF THIS 정모.
  const inTurn = await prisma.turnPlayer.findMany({
    where: { turn: { clubSessionId, status: { in: ['WAITING', 'PLAYING'] } } },
    select: { userId: true },
  });
  for (const t of inTurn) busy.add(t.userId);

  // (b) Appearing in more than one QUEUED entry.
  const counts = new Map<string, number>();
  for (const e of rawEntries) {
    if (e.status !== 'QUEUED') continue;
    for (const pid of e.playerIds as string[]) {
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
  }
  for (const [pid, n] of counts) {
    if (n > 1) busy.add(pid);
  }

  return Array.from(busy);
}

async function formatEntry(entry: any) {
  const court = entry.courtId
    ? await prisma.court.findUnique({ where: { id: entry.courtId } })
    : null;
  const players = await prisma.user.findMany({
    where: { id: { in: entry.playerIds } },
    select: { id: true, name: true },
  });
  const playerNameMap = new Map(players.map((p) => [p.id, p.name]));

  return {
    id: entry.id,
    boardId: entry.boardId,
    courtId: entry.courtId || null,
    courtName: court?.name || '',
    position: entry.position,
    queueOrder: entry.queueOrder ?? 0,
    note: entry.note ?? null,
    playerIds: entry.playerIds,
    playerNames: entry.playerIds.map((id: string) => playerNameMap.get(id) || ''),
    status: entry.status,
    turnId: entry.turnId,
    createdAt: entry.createdAt.toISOString(),
  };
}

async function getPlayerNames(playerIds: string[]): Promise<string[]> {
  const players = await prisma.user.findMany({
    where: { id: { in: playerIds } },
    select: { name: true },
  });
  return players.map((p) => p.name);
}
