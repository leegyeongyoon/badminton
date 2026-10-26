import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket';
import { registerTurn } from '../turn/turn.service';
import { sendPushToUser } from '../notification/notification.service';
import {
  selectFoursomeByMode,
  completeGroup,
  levelSpread,
  splitTeams,
  resolveTuning,
  SUGGEST_TUNABLES,
  type SuggestMode,
  type ModePlayer,
  type SuggestTuning,
  type StyleScorer,
  type RequestHooks,
} from './suggest.algorithm';
import { getClubStyle, styleUtility, type ClubStyle, DEFAULT_SPREAD_CAP } from './clubStyle';
import { activeRequestsForEngine } from './sessionRequest.service';

// Map a SkillLevel enum (S strongest … F weakest; null=미설정) to a number used
// by the mode-based matching. null → 4 (mid), matching the spec.
const SKILL_TO_NUM: Record<string, number> = {
  S: 7,
  A: 6,
  B: 5,
  C: 4,
  D: 3,
  E: 2,
  F: 1,
};
function skillToNum(level: string | null | undefined): number {
  return level ? SKILL_TO_NUM[level] ?? 4 : 4;
}
const NUM_TO_SKILL = ['', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

// ─── 클럽 페이스(실데이터) ─────────────────────────────────────────────
// 이 클럽의 최근 90일 '완료된 판' 시간(분) 분포. 자동 편성의 공평 주기 + 운영판의
// '코트 언제 비나' 예측 기본값으로 쓴다. 표본이 적은 신생 클럽은 기본값(13분).
// (터닝포인트 실측 2026-10: 2,682판 중앙값 12.4분, p75 14.3분, p90 16.2분)
export interface ClubPace {
  medianGameMin: number;
  p75GameMin: number;
  /** 정모 시작 1시간 안의 판 중앙값(몸 풀리기 전이라 김 — 터닝 13.8분) / 그 이후(12.0분). */
  firstHourGameMin: number;
  laterGameMin: number;
  sample: number;
  source: 'club' | 'default';
}
const DEFAULT_PACE: ClubPace = {
  medianGameMin: 13,
  p75GameMin: 15,
  firstHourGameMin: 14,
  laterGameMin: 12.5,
  sample: 0,
  source: 'default',
};
const PACE_MIN_SAMPLE = 20;
const PACE_TTL_MS = 10 * 60 * 1000;
const paceCache = new Map<string, { at: number; pace: ClubPace }>();

export async function getClubPace(clubId: string): Promise<ClubPace> {
  const hit = paceCache.get(clubId);
  if (hit && Date.now() - hit.at < PACE_TTL_MS) return hit.pace;
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const rows = await prisma.$queryRaw<
    { median: number | null; p75: number | null; first: number | null; later: number | null; n: bigint }[]
  >`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY m) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY m) AS p75,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE phase < 60) AS first,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE phase >= 60) AS later,
           count(*) AS n
    FROM (
      SELECT EXTRACT(EPOCH FROM (ct."completedAt" - ct."startedAt")) / 60.0 AS m,
             EXTRACT(EPOCH FROM (ct."startedAt" - cs."startedAt")) / 60.0 AS phase
      FROM "CourtTurn" ct
      JOIN "ClubSession" cs ON cs.id = ct."clubSessionId"
      WHERE cs."clubId" = ${clubId}
        AND ct.status = 'COMPLETED'
        AND ct."startedAt" IS NOT NULL AND ct."completedAt" IS NOT NULL
        AND ct."startedAt" > ${since}
    ) x
    WHERE m BETWEEN 3 AND 60`;
  const r = rows[0];
  const n = r ? Number(r.n) : 0;
  const pace: ClubPace =
    r && n >= PACE_MIN_SAMPLE && r.median != null && r.p75 != null
      ? {
          medianGameMin: Math.round(Number(r.median) * 10) / 10,
          p75GameMin: Math.round(Number(r.p75) * 10) / 10,
          firstHourGameMin: Math.round(Number(r.first ?? r.median) * 10) / 10,
          laterGameMin: Math.round(Number(r.later ?? r.median) * 10) / 10,
          sample: n,
          source: 'club',
        }
      : DEFAULT_PACE;
  paceCache.set(clubId, { at: Date.now(), pace });
  return pace;
}

// 학습 스타일 요약(운영판 표시용) — 무엇을 배웠는지 사람이 읽을 수 있게.
function summarizeStyle(style: ClubStyle | null) {
  if (!style) return null;
  return { decisions: style.decisions, testAccuracy: style.testAccuracy, traits: style.traits, trainedAt: style.trainedAt };
}

// 정모 기준 페이스 — 클럽 페이스 + 1인당 한 판 주기(판당 시간 × 인원/(4×코트)).
export async function getSessionPace(clubSessionId: string) {
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { clubId: true, startedAt: true },
  });
  if (!session) throw new NotFoundError('클럽 세션');
  const pace = await getClubPace(session.clubId);
  const [courts, rotating] = await Promise.all([
    prisma.court.count({ where: { clubSessionId, status: { not: 'MAINTENANCE' } } }),
    prisma.checkIn.count({ where: { clubSessionId, checkedOutAt: null, restingAt: null, isInLesson: false } }),
  ]);
  const ratio = courts > 0 ? Math.max(1, rotating / (4 * courts)) : 1;
  const style = await getClubStyle(session.clubId);
  const elapsedMin = (Date.now() - session.startedAt.getTime()) / 60000;
  return {
    ...pace,
    // 지금 시점에 맞는 판당 시간 — 정모 첫 1시간은 더 길게.
    currentGameMin: elapsedMin < 60 ? pace.firstHourGameMin : pace.laterGameMin,
    style: summarizeStyle(style),
    courts,
    rotatingPlayers: rotating,
    // 한 사람이 다음 판까지 걸리는 평균 주기(분) — 판당 시간 × 대기 비율.
    personCycleMin: Math.round(pace.medianGameMin * ratio * 10) / 10,
  };
}

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
  const fetchBoard = () =>
    prisma.gameBoard.findUnique({
      where: { clubSessionId },
      include: {
        // Court-less QUEUED entries ordered by the global queueOrder (다음 게임 순서);
        // on-court / materialized entries keep their createdAt order. formatBoard
        // re-sorts so QUEUED come first by queueOrder, then the rest by createdAt.
        // Only ACTIVE entries belong on the board. COMPLETED/CANCELLED entries
        // (their turn finished or was cancelled) must be excluded, otherwise the
        // operator board keeps showing the court/players as 게임중 forever.
        entries: {
          where: { status: { in: ['QUEUED', 'MATERIALIZED', 'PLAYING'] } },
          orderBy: [{ queueOrder: 'asc' }, { position: 'asc' }],
        },
      },
    });

  let board = await fetchBoard();

  // No board yet → the operator hasn't opened the operate board. Returning a 404
  // here surfaced as "요청한 정보를 찾을 수 없습니다": on the 현황 보드 when a viewer
  // opened it before the operator, and as a transient loadBoard(GET)-vs-
  // createBoard(POST) race on the operate board itself. For an ACTIVE 정모, lazily
  // create an empty board so this GET never 404s — viewers and the operator both
  // always get a valid (possibly empty) board.
  if (!board) {
    const clubSession = await prisma.clubSession.findUnique({ where: { id: clubSessionId } });
    if (!clubSession) throw new NotFoundError('정모');
    if (clubSession.status === 'ACTIVE') {
      try {
        await prisma.gameBoard.create({
          data: {
            clubSessionId,
            facilityId: clubSession.facilityId,
            createdById: clubSession.startedById,
          },
        });
      } catch {
        // Unique-constraint race: a concurrent request created it first — fine.
      }
      board = await fetchBoard();
    }
  }

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
  teamSplit = false,
) {
  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: { entries: { where: { status: 'QUEUED' } } },
  });
  if (!board) throw new NotFoundError('모임판');

  // 레슨 중인 회원은 대기열(QUEUED)에도 넣지 못하게 하드 차단(코트 배정 전 단계).
  const lessonCheckins = await prisma.checkIn.findMany({
    where: {
      facilityId: board.facilityId,
      clubSessionId: board.clubSessionId,
      checkedOutAt: null,
      userId: { in: playerIds },
      isInLesson: true,
    },
    select: { userId: true },
  });
  if (lessonCheckins.length > 0) {
    throw new BadRequestError('레슨 중인 회원은 대기열에 넣을 수 없어요');
  }

  // A1 (SOFT double-booking): the operator may PRE-DRAFT a future QUEUED game
  // with a player already composed/playing elsewhere this 정모. The former HARD
  // block (assertNotAlreadyBooked) is removed — creating/editing a QUEUED entry
  // never errors on a player already in another game. The double-booked signal
  // is now a non-blocking red dot (computeBusyPlayerIds). COURT-occupancy +
  // check-in + penalty + maintenance + court-ownership checks remain on the
  // assign/materialize path.

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
      teamSplit: teamSplit && playerIds.length === 4,
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
  teamSplit = false,
) {
  await verifyBoardStaff(boardId, userId);
  // courtId omitted → court-less queued entry (assigned later via assignEntry).
  return addEntry(boardId, playerIds, userId, undefined, note, teamSplit);
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
  const board = await verifyBoardStaff(boardId, userId);

  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');
  if (court.status === 'MAINTENANCE') {
    throw new BadRequestError('점검 중(사용 불가)인 코트에는 배정할 수 없습니다');
  }

  // Per-정모 ownership: the court must belong to THIS 정모 (clubSessionId).
  if (court.clubSessionId !== board.clubSessionId) {
    throw new BadRequestError('이 정모의 코트가 아닙니다');
  }

  // Reject only if an active turn/game already occupies this court. Courts are
  // owned by exactly one 정모, so any active WAITING/PLAYING turn on it is ours.
  const occupied = await prisma.courtTurn.findFirst({
    where: {
      courtId,
      status: { in: ['WAITING', 'PLAYING'] },
    },
  });
  if (occupied) {
    throw new BadRequestError('이미 사용 중인 코트입니다. 빈 코트에 배정하세요');
  }

  return pushEntry(boardId, entryId, courtId, userId);
}

export async function updateEntry(
  boardId: string,
  entryId: string,
  playerIds: string[],
  extra: { note?: string | null; teamSplit?: boolean } = {},
) {
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 수정할 수 있습니다');

  const updated = await prisma.gameBoardEntry.update({
    where: { id: entryId },
    // 4명이 아니게 되면 팀 구성([A1,A2,B1,B2]) 의미가 깨지므로 해제. 자리 교체(4명 유지)는 팀 유지.
    data: {
      playerIds,
      ...(extra.note !== undefined ? { note: extra.note } : {}),
      ...(extra.teamSplit !== undefined ? { teamSplit: extra.teamSplit && playerIds.length === 4 } : {}),
      ...(playerIds.length !== 4 ? { teamSplit: false } : {}),
    },
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

  // 자동 편성 팀 구성([A1, A2, B1, B2])이면 실제 순번 선수에 제안 팀을 기록(파트너 통계용).
  if (entry.teamSplit && entry.playerIds.length === 4) {
    const [a1, a2, b1, b2] = entry.playerIds;
    await prisma.turnPlayer.updateMany({ where: { turnId: turn.id, userId: { in: [a1, a2] } }, data: { team: 'A' } });
    await prisma.turnPlayer.updateMany({ where: { turnId: turn.id, userId: { in: [b1, b2] } }, data: { team: 'B' } });
  }

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

// 코트에 잘못 배정한 게임을 다시 대기 큐로 되돌린다(배정 취소).
// 빈 코트 배정은 registerTurn 이 즉시 PLAYING + Game(IN_PROGRESS) + 코트 IN_USE 로
// 만들므로, 되돌리기는 ①그 CourtTurn/Game 을 취소(기록에 안 남김) ②코트를 비우고
// ③GameBoardEntry 를 원래 자리(position 유지)로 QUEUED 복원한다. 이미 '완료'된 게임엔
// 쓸 수 없다(그건 종료로 처리). 코트 기준으로 활성 편성 엔트리를 서버가 직접 찾는다.
export async function unassignEntryByCourt(boardId: string, courtId: string, userId: string) {
  const board = await verifyBoardStaff(boardId, userId);

  const entry = await prisma.gameBoardEntry.findFirst({
    where: { boardId, courtId, status: { in: ['MATERIALIZED', 'PLAYING'] } },
  });
  if (!entry) throw new BadRequestError('이 코트에 되돌릴 배정 게임이 없어요');

  const turn = entry.turnId
    ? await prisma.courtTurn.findUnique({ where: { id: entry.turnId } })
    : null;
  if (turn && turn.status === 'COMPLETED') {
    throw new BadRequestError('이미 끝난 게임은 되돌릴 수 없어요 (종료로 처리하세요)');
  }

  await prisma.$transaction(async (tx) => {
    if (turn) {
      // 자동 시작됐던 게임/순번을 취소 — 실제로 안 한 게임이므로 기록/통계에 남기지 않는다.
      await tx.game.updateMany({ where: { turnId: turn.id, status: 'IN_PROGRESS' }, data: { status: 'CANCELLED' } });
      await tx.courtTurn.update({ where: { id: turn.id }, data: { status: 'CANCELLED' } });
    }
    // 편성 엔트리를 원래 대기 자리(position 유지)로 QUEUED 복원.
    await tx.gameBoardEntry.update({
      where: { id: entry.id },
      data: { status: 'QUEUED', courtId: null, turnId: null },
    });
    // 코트에 남은 활성 순번이 없으면 EMPTY 로(점검 중이면 유지).
    const remaining = await tx.courtTurn.count({ where: { courtId, status: { in: ['WAITING', 'PLAYING'] } } });
    if (remaining === 0) {
      const court = await tx.court.findUnique({ where: { id: courtId } });
      if (court && court.status !== 'MAINTENANCE') {
        await tx.court.update({ where: { id: courtId }, data: { status: 'EMPTY' } });
      }
    }
  });

  // 실시간 반영 — 운영판/현황판/모니터가 보드·코트 상태를 새로고침.
  const restored = await prisma.gameBoardEntry.findUniqueOrThrow({ where: { id: entry.id } });
  const formatted = await formatEntry(restored);
  const io = getIO();
  io.to(`facility:${board.facilityId}`).emit('gameBoard:entryUpdated', formatted);
  io.to(`facility:${board.facilityId}`).emit('court:statusChanged', { courtId });
  if (turn) io.to(`court:${courtId}`).emit('turn:cancelled', { courtId, turnId: turn.id });
  io.to(`facility:${board.facilityId}`).emit('clubSession:courtsUpdated', { facilityId: board.facilityId });

  return formatted;
}

export async function pushAllEntries(boardId: string, userId: string) {
  const board = await prisma.gameBoard.findUnique({
    where: { id: boardId },
    include: {
      clubSession: true,
      entries: { where: { status: 'QUEUED' }, orderBy: { position: 'asc' } },
    },
  });
  if (!board) throw new NotFoundError('모임판');

  // This 정모's OWN courts (Court.clubSessionId), non-maintenance.
  const courts = await prisma.court.findMany({
    where: { clubSessionId: board.clubSessionId, status: { not: 'MAINTENANCE' } },
    orderBy: { name: 'asc' },
  });
  if (courts.length === 0) return [];

  // Only fill EMPTY courts — an active WAITING/PLAYING turn on this 정모's court
  // means occupied. Never stack onto occupied.
  const occupiedTurns = await prisma.courtTurn.findMany({
    where: {
      clubSessionId: board.clubSessionId,
      status: { in: ['WAITING', 'PLAYING'] },
    },
    select: { courtId: true },
  });
  const occupiedCourtIds = new Set(occupiedTurns.map((t) => t.courtId));
  const emptyCourts = courts.filter((c) => !occupiedCourtIds.has(c.id));

  const results = [];
  let courtIdx = 0;
  for (const entry of board.entries) {
    if (courtIdx >= emptyCourts.length) break;
    // assignEntry re-checks the empty-guard + court membership (race-safe).
    try {
      const result = await assignEntry(boardId, entry.id, emptyCourts[courtIdx].id, userId);
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
  opts: {
    courtId?: string;
    count?: number;
    mode?: SuggestMode;
    exclude?: string[];
    tuning?: Partial<SuggestTuning>;
    /** 운영판 '편성 기준' — 주면 mode·동성/순환 tuning 대신 이걸로 정한다(아래 prefs 해석). */
    prefs?: {
      levelMatch?: 'tight' | 'normal' | 'loose';
      gameType?: 'same' | 'even' | 'mixed';
      avoidRepeat?: 'normal' | 'strong';
    };
    /**
     * 대상 게임 모드(운영진 방식):
     *  · fill: 대기 게임(entryId)에 이미 들어간 1~3명은 고정, 나머지 자리를 채움("한두 명 먼저 넣고 나중에 채우기")
     *  · substitute: 땜빵 — 대기 게임(entryId) 또는 코트 진행 중 게임(turnId)에서 outUserId(선택)를 뺀
     *    나머지를 고정하고 빈 1자리 후보를 점수순 3명 추천
     */
    target?: { kind: 'fill' | 'substitute'; entryId?: string; turnId?: string; outUserId?: string };
  },
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
  const nowMs = now.getTime();
  const count = opts.count ?? 1;

  // ─────────────────────────────────────────────────────────────────────────
  // 후보: '쉬는 사람 우선, 모자라면 시간 기준'(혼합). 터닝 재생 평가(뒤 20% 정모 596편성):
  //  · 쉬는 사람이 4명 이상인 순간엔 쉬는 사람 중에서 고르는 게 운영진과 가장 비슷(같은 사람
  //    45% vs 시간 기준 38%) → 그대로 쉬는 사람 우선.
  //  · 쉬는 사람이 4명 미만인 순간(전체의 36%)엔 예전 엔진은 아무것도 못 짰다 → 이때만 아래
  //    시간 기준으로 '곧 끝날 사람'까지 넣어 미리 짠다(운영진 방식).
  // 시간 기준 후보(운영진 방식). 터닝포인트 3,047편성 분석(2026-10): 운영진은 코트 시작
  // ~16분 전에 미리 짜고, 편성의 70%에 '지금 코트에서 치는 중(평균 6분 남음)'인 사람을,
  // 1,258명은 '이미 앞 대기 게임에 있는' 사람을 넣었다. 즉 기준은 '지금 쉬는 사람'이 아니라
  // '이 게임이 시작될 때 비어 있을 사람'. 그래서:
  //   ① 코트별 종료 예상(진행 중 = 시작 + 판당 시간)
  //   ② 이미 짠 대기 게임을 순서대로 코트에 배치하는 시뮬레이션 → 각자 '비는 시각'
  //   ③ 새 게임 시작 예상 S = 가장 먼저 비는 코트
  //   ④ 후보 = S(+2분)까지 비는 사람 · 대기/체류/판수는 S 기준
  // 실제 코트 투입은 registerTurn 가드가 '다른 코트에서 게임 중'이면 막으므로 물리적 모순 없음.
  // ─────────────────────────────────────────────────────────────────────────
  const SLACK_MS = 2 * 60 * 1000;

  const checkins = await prisma.checkIn.findMany({
    where: { clubSessionId, checkedOutAt: null },
    select: { userId: true, restingAt: true, isInLesson: true, checkedInAt: true },
  });
  const restingIds = new Set(checkins.filter((c) => c.restingAt).map((c) => c.userId));
  // 레슨 중인 사람 — 자동 추천에서 제외(레슨자 박스로 분리, 수동으로만 코트 배정).
  const inLessonIds = new Set(checkins.filter((c) => c.isInLesson).map((c) => c.userId));
  const penalizedIds = new Set(
    (await prisma.noShowRecord.findMany({ where: { penaltyEndsAt: { gt: now } }, select: { userId: true } })).map(
      (p) => p.userId,
    ),
  );
  // 운영자가 트레이에 올려둔(아직 대기 게임이 아닌) 사람 등 — 클라이언트 지정 제외.
  const excludeIds = new Set(opts.exclude ?? []);
  // 코트 앞에 줄 선(WAITING) 순번은 언제 시작할지 몰라 제외(보드 흐름에선 드묾).
  const waitingTurnIds = new Set(
    (
      await prisma.turnPlayer.findMany({
        where: { turn: { clubSessionId, status: 'WAITING' } },
        select: { userId: true },
      })
    ).map((t) => t.userId),
  );

  const pace = await getClubPace(clubSession.clubId);
  const elapsedMin = (nowMs - clubSession.startedAt.getTime()) / 60000;
  const gameMs = (elapsedMin < 60 ? pace.firstHourGameMin : pace.laterGameMin) * 60 * 1000;

  // ① 코트 종료 예상
  const courts = await prisma.court.findMany({
    where: { clubSessionId, status: { not: 'MAINTENANCE' } },
    select: {
      id: true,
      turns: {
        where: { status: 'PLAYING', startedAt: { not: null } },
        select: { startedAt: true, players: { select: { userId: true } } },
      },
    },
  });
  const availMs = new Map<string, number>(); // 확정 일정(진행·대기 게임)이 끝나는 시각
  const committedGames: Record<string, number> = {}; // 대기 게임으로 잡힌 판수
  const courtFree: number[] = [];
  for (const c of courts) {
    const playing = c.turns[0];
    if (playing?.startedAt) {
      const end = Math.max(nowMs + 60 * 1000, playing.startedAt.getTime() + gameMs);
      courtFree.push(end);
      for (const p of playing.players) availMs.set(p.userId, end);
    } else {
      courtFree.push(nowMs);
    }
  }
  if (courtFree.length === 0) courtFree.push(nowMs);
  const popEarliest = () => {
    let i = 0;
    for (let j = 1; j < courtFree.length; j++) if (courtFree[j] < courtFree[i]) i = j;
    return courtFree.splice(i, 1)[0];
  };

  // ② 이미 짠 대기 게임을 순서대로 코트에 배치
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { where: { status: 'QUEUED' }, select: { id: true, playerIds: true, queueOrder: true } } },
  });
  const queued = [...(board?.entries ?? [])].sort((a, b) => a.queueOrder - b.queueOrder);
  // 대상 게임 모드: 그 게임 앞 순서까지만 시뮬레이션 → 그 게임의 시작 예상 시각. 뒤 순서 게임에 잡힌
  // 사람은 후보에서 뺀다(채우면 뒤 일정이 꼬임). 코트 진행 중 게임 땜빵은 '지금' 기준.
  const target = opts.target;
  let targetFixed: string[] | null = null;
  let targetStart = nowMs;
  const laterIds = new Set<string>();
  if (target?.turnId) {
    const turn = await prisma.courtTurn.findUnique({
      where: { id: target.turnId },
      select: { clubSessionId: true, status: true, players: { select: { userId: true } } },
    });
    if (!turn || turn.clubSessionId !== clubSessionId) throw new NotFoundError('게임');
    targetFixed = turn.players.map((p) => p.userId).filter((id) => id !== target.outUserId);
  }
  let reachedTarget = false;
  for (const e of queued) {
    const ids = (e.playerIds as string[]) ?? [];
    if (target?.entryId && e.id === target.entryId) {
      reachedTarget = true;
      targetFixed = ids.filter((id) => id !== target.outUserId);
      targetStart = Math.max(nowMs, Math.min(...courtFree), ...targetFixed.map((id) => availMs.get(id) ?? nowMs));
      continue;
    }
    if (reachedTarget) {
      ids.forEach((id) => laterIds.add(id));
      continue;
    }
    const start = Math.max(popEarliest(), ...ids.map((id) => availMs.get(id) ?? nowMs));
    const end = start + gameMs;
    courtFree.push(end);
    for (const id of ids) {
      availMs.set(id, end);
      committedGames[id] = (committedGames[id] ?? 0) + 1;
    }
  }

  // 이유 문구용: 지금 실제로 코트에서 치는 사람(진행 중 게임).
  const playingNowIds = new Set(courts.flatMap((c) => (c.turns[0]?.players ?? []).map((p) => p.userId)));

  // ③ 새 게임 시작 예상
  let slotStart = Math.max(nowMs, Math.min(...courtFree));

  // ④ 후보 바탕(시간 조건은 슬롯마다)
  const baseIds = checkins
    .map((c) => c.userId)
    .filter(
      (id) =>
        !restingIds.has(id) &&
        !inLessonIds.has(id) &&
        !penalizedIds.has(id) &&
        !excludeIds.has(id) &&
        !waitingTurnIds.has(id),
    );
  const freeBy = (id: string, at: number) => (availMs.get(id) ?? nowMs) <= at + SLACK_MS;
  // 지금 쉬는 사람 = 진행·대기 게임(및 이번 호출에서 짠 판) 일정이 없는 사람.
  const isIdle = (id: string) => (availMs.get(id) ?? 0) <= nowMs;
  if (target && !targetFixed) throw new NotFoundError('대기 게임');
  if (!target && baseIds.filter((id) => freeBy(id, slotStart)).length < 4) {
    return { suggestions: [] };
  }
  // 대상 게임의 고정 인원도 급수·성별·이름을 불러오도록 풀 목록에 포함(후보에선 제외).
  const poolIds = targetFixed
    ? Array.from(new Set([...baseIds, ...targetFixed, ...(target?.outUserId ? [target.outUserId] : [])]))
    : baseIds;
  const checkedInAtMs: Record<string, number> = {};
  for (const c of checkins) checkedInAtMs[c.userId] = c.checkedInAt.getTime();

  // ── 이번 정모 기록(판수·혼복/동성복·마지막 게임 종료) ──
  const sessionGames = await prisma.game.findMany({
    where: { turn: { clubSessionId } },
    select: {
      createdAt: true,
      updatedAt: true,
      turn: { select: { startedAt: true, completedAt: true } },
      players: { select: { userId: true } },
    },
  });
  // 과거 게임 타입(혼복/동성복) 분류를 위해 '이번 정모에서 게임한 모든 참가자'의 성별을
  // 모은다(풀 밖 상대까지 포함해야 그 게임이 혼복이었는지 판정 가능).
  const gameUserIds = Array.from(new Set(sessionGames.flatMap((g) => g.players.map((p) => p.userId))));
  const gameProfiles = gameUserIds.length
    ? await prisma.playerProfile.findMany({ where: { userId: { in: gameUserIds } }, select: { userId: true, gender: true } })
    : [];
  const genderOf = new Map(
    gameProfiles.map((p) => [p.userId, p.gender === 'M' || p.gender === 'F' ? p.gender : null] as const),
  );
  const playedGames: Record<string, number> = {};
  const mixedGamesCount: Record<string, number> = {};
  const sameGamesCount: Record<string, number> = {};
  const lastEndMs: Record<string, number> = {}; // 끝난 게임의 종료 시각(진행 중은 availMs가 담당)
  for (const g of sessionGames) {
    let gm = 0;
    let gf = 0;
    for (const gp of g.players) {
      const gg = genderOf.get(gp.userId);
      if (gg === 'M') gm++;
      else if (gg === 'F') gf++;
    }
    const isMixed = gm >= 1 && gf >= 1;
    const endMs = g.turn?.completedAt ? g.turn.completedAt.getTime() : 0;
    for (const gp of g.players) {
      playedGames[gp.userId] = (playedGames[gp.userId] ?? 0) + 1;
      if (isMixed) mixedGamesCount[gp.userId] = (mixedGamesCount[gp.userId] ?? 0) + 1;
      else sameGamesCount[gp.userId] = (sameGamesCount[gp.userId] ?? 0) + 1;
      if (endMs > (lastEndMs[gp.userId] ?? 0)) lastEndMs[gp.userId] = endMs;
    }
  }

  // ── 급수·성별(모임별 급수가 우선) ──
  const profiles = await prisma.playerProfile.findMany({
    where: { userId: { in: poolIds } },
    select: { userId: true, skillLevel: true, gender: true },
  });
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const skillOverrides = await prisma.clubMember.findMany({
    where: { clubId: clubSession.clubId, userId: { in: poolIds } },
    select: { userId: true, skillLevel: true },
  });
  const skillOverrideMap = new Map(skillOverrides.map((m) => [m.userId, m.skillLevel]));

  // 선수별 고정 정보 + 슬롯 시각 기준으로 계산되는 공평 정보.
  const extraGames: Record<string, number> = {}; // 이번 호출에서 미리 짠 판수(다음 슬롯 공평 반영)
  const extraMixed: Record<string, number> = {};
  const extraSame: Record<string, number> = {};
  const toModePlayer = (id: string, at: number): ModePlayer => {
    const prof = profileMap.get(id);
    const g = prof?.gender;
    const checkin = checkedInAtMs[id] ?? at;
    const lastActivity = Math.max(checkin, lastEndMs[id] ?? 0, availMs.get(id) ?? 0);
    return {
      id,
      skill: skillToNum(skillOverrideMap.get(id) ?? prof?.skillLevel),
      games: (playedGames[id] ?? 0) + (committedGames[id] ?? 0) + (extraGames[id] ?? 0),
      gender: g === 'M' || g === 'F' ? g : null,
      waitSeconds: Math.max(0, (at - lastActivity) / 1000),
      timePresentSeconds: Math.max(0, (at - checkin) / 1000),
      mixedGames: (mixedGamesCount[id] ?? 0) + (extraMixed[id] ?? 0),
      sameGames: (sameGamesCount[id] ?? 0) + (extraSame[id] ?? 0),
    };
  };
  const modePool = poolIds.map((id) => toModePlayer(id, slotStart));

  // ── 짝 기록(겹침 회피, 최근일수록 무겁게) — 대기 게임은 '곧 칠 판'이라 최대 가중 ──
  const pairWeight: Record<string, number> = {};
  const HL = SUGGEST_TUNABLES.PAIR_RECENCY_HALFLIFE_SECONDS;
  const decay = (whenMs: number): number => {
    if (!whenMs) return 0.25;
    return Math.pow(0.5, Math.max(0, (nowMs - whenMs) / 1000) / HL);
  };
  const pkey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addPairWeight = (ids: string[], whenMs: number) => {
    const w = decay(whenMs);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pkey(ids[i], ids[j]);
        pairWeight[k] = (pairWeight[k] ?? 0) + w;
      }
  };
  for (const g of sessionGames) {
    const t = g.turn?.completedAt ?? g.turn?.startedAt ?? g.updatedAt ?? g.createdAt;
    addPairWeight(g.players.map((p) => p.userId), t ? new Date(t).getTime() : 0);
  }
  for (const e of queued) addPairWeight((e.playerIds as string[]) ?? [], nowMs);

  let mode: SuggestMode = opts.mode ?? 'fair';

  // ── 실데이터 페이스 → 공평 주기(1인 주기 = 판당 시간 × max(1, 인원/(4×코트))) ──
  const rotatingCount = checkins.filter((c) => !c.restingAt && !c.isInLesson).length;
  const ratio = courts.length > 0 ? Math.max(1, rotatingCount / (4 * courts.length)) : 1;
  // ── 모임 학습 스타일 — 이 모임 운영진이 과거에 4명을 어떻게 묶었는지(기록 학습, 12시간 캐시) ──
  const style = await getClubStyle(clubSession.clubId);
  // 기록이 없는(학습 스타일 없는) 모임에서 '공정'은 급수를 전혀 안 본다 → 예전 기본값 '비슷한 급수'로.
  // (기본 모드를 '공정'으로 바꾼 건 학습 스타일이 급수 묶는 방식을 대신 맡는 모임 기준이었다.)
  if (!style && mode === 'fair') mode = 'similar';
  // 학습 스타일이 성별 선호(남복·여복/혼복 2:2)를 이미 담고 있어, 수동 '동성 우선'이 기본값(0.5)
  // 그대로면 끈다 — 둘이 겹치면 운영진보다 남복·여복을 과하게 짠다(재생 평가: 71% → 61%, 운영진 59%).
  // 운영자가 직접 바꾼 값은 존중.
  // (이전엔 학습 스타일이 있으면 수동 동성 우선을 껐지만, 실제 운영에서 혼복이 과다해 운영진 피드백으로 유지.)
  // ── 운영판 '편성 기준' 3가지(운영진 말) → 엔진 값. 선택지마다 결과가 눈에 띄게 달라지게 잡았다
  //    (같은 출석 비교: scratchpad mode_cmp). 예전 클라이언트(mode·tuning)는 그대로 동작.
  //  · 급수 맞추기: 딱 맞게 = 급수 폭 1단계까지만(2단계 금지, 대신 기다릴 수 있음) / 보통 = 2단계는 가끔 /
  //    넉넉하게 = 2단계도 부담 없이(빨리 돌림, 3단계+는 여전히 금지)
  //  · 게임 종류: 남복·여복 위주 / 골고루(혼복도 섞어) / 혼복 위주
  //  · 같은 사람 또 만나기: 보통 / 최대한 피하기
  const prefs = opts.prefs;
  const levelMatch = prefs?.levelMatch ?? 'normal';
  const gameType = prefs?.gameType ?? 'same';
  let prefTuning: Partial<SuggestTuning> = {};
  if (prefs) {
    mode = 'similar';
    prefTuning = {
      levelWeight: levelMatch === 'tight' ? 2.5 : levelMatch === 'loose' ? 0 : style ? 0.5 : 1.5,
      varietyWeight: prefs.avoidRepeat === 'strong' ? 3 : 1,
      sameGenderWeight: gameType === 'same' ? 1.5 : gameType === 'even' ? 0.8 : 0,
      typeVarietyWeight: gameType === 'even' ? 0.6 : 0,
    };
  }
  const tuning: Partial<SuggestTuning> = { ...opts.tuning, ...prefTuning, gameCycleSeconds: (gameMs / 1000) * ratio };
  const tune = resolveTuning(tuning);
  let styleScorer: StyleScorer | undefined;
  // 학습 스타일은 운영진 평소 방식(남복·여복 위주)을 담고 있어, 운영자가 게임 종류를 바꿨으면 끈다.
  if (style && gameType === 'same') {
    const guestIds = new Set(
      (await prisma.user.findMany({ where: { id: { in: poolIds }, isGuest: true }, select: { id: true } })).map((u) => u.id),
    );
    styleScorer = (group) =>
      styleUtility(style, group.map((p) => ({ id: p.id, skill: p.skill, gender: p.gender, guest: guestIds.has(p.id) })));
  }

  // ── 운영진 요청(파트너로 같이 N게임 / 같이 안 짜기) ──
  // 같이 친 판수 = 실제 시작된 판 + 대기 게임에 이미 함께 잡힌 판 + 이번 호출에서 짠 판. 목표 판수를
  // 채우면 그 파트너 요청은 더 이상 적용 안 함. '같이 안 짜기'는 사실상 금지(큰 비용).
  // 파트너 둘이 함께면 가산 — 기본 4 + 두 사람 급수 차이 보정(급수 다른 대회 파트너도 '급수 비슷하게'·학습
  // 스타일의 급수 폭 비용에 밀리지 않게). 누가 칠 차례인지는 공평이 정하고, 요청은 '같이 칠 때 같이'.
  const TOGETHER_BONUS = 4;
  const TOGETHER_GAP_COMP = 2.5; // 급수 1단계 차이당 보정
  const PARTNER_MISSING = 8; // 파트너가 후보로 비어 있는데 한 명만 넣으면 큰 비용(둘을 갈라놓지 않게)
  const APART_COST = 1000;
  const requests = await activeRequestsForEngine(clubSessionId);
  const apartKeys = new Set(requests.filter((r) => r.kind === 'APART').map((r) => pkey(r.aId, r.bId)));
  const togetherReqs = requests.filter((r) => r.kind === 'TOGETHER');
  const togetherSoFar: Record<string, number> = {};
  for (const r of togetherReqs) togetherSoFar[pkey(r.aId, r.bId)] = r.played;
  for (const e of queued) {
    const ids = (e.playerIds as string[]) ?? [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pkey(ids[i], ids[j]);
        if (k in togetherSoFar) togetherSoFar[k] += 1;
      }
  }
  const activeTogether = () =>
    new Set(
      togetherReqs
        .filter((r) => r.games == null || togetherSoFar[pkey(r.aId, r.bId)] < r.games)
        .map((r) => pkey(r.aId, r.bId)),
    );
  // ── 운영진 급수·성별 규칙(하드) — 터닝 운영진 확인(2026-10-23) ──
  //  · 한 판 급수 폭(여자 2단계 보정)은 모임 기록 95% 상한(기본 2) 이하. 파트너 요청 판은 예외.
  //  · 여자 C급 이하는 혼복(남2·여2)·여복으로만 — 남자 3명 사이 여자 1명(3:1)은 여자 B급 이상만.
  // 규칙 안 4명이 없으면 억지로 짜지 않고 '곧 나올 사람'까지 보거나 기다린다(아래 슬롯 선택).
  // 급수 폭(보정): 0~1단계가 기본, 2단계는 가끔(큰 비용), 3단계+ 금지. 모임 기록 상한이 더 좁으면 그걸로.
  // 운영진 피드백(2026-10-24): "남복도 C·E·C·E처럼 섞여 들어간다 — 비슷한 급수나 1~2급 위와 치고 싶어 한다".
  const spreadCap = Math.min(style?.spreadCap ?? DEFAULT_SPREAD_CAP, levelMatch === 'tight' ? 1 : 2);
  // 2단계 판 — 보통이면 1단계 이하 조합이 있으면 그쪽(공평 4게임 상당), 넉넉하게면 거의 부담 없이.
  const SPREAD2_COST = levelMatch === 'loose' ? 0.5 : 4;
  const RULE_COST = 500;
  const effOf = (p: ModePlayer) => p.skill + (p.gender === 'F' ? tune.genderOffsetFemale : 0);
  // 혼복 2:2의 남녀 급수 관계: 남자가 여자보다 최대 3단계 높아도 됨(남자가 받쳐주는 구조, 여자 F조가
  // 혼복으로 자주 들어가는 이유). 여자가 남자보다 높은 건 1단계까지. (운영진 피드백 2026-10-24)
  const mixedGap = (g: ModePlayer[]) => {
    const f = g.filter((p) => p.gender === 'F');
    const m = g.filter((p) => p.gender === 'M');
    if (g.length !== 4 || f.length !== 2 || m.length !== 2) return null;
    return (m[0].skill + m[1].skill) / 2 - (f[0].skill + f[1].skill) / 2;
  };
  const hasRequestPair = (g: ModePlayer[], activeKeys: Set<string>) => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (activeKeys.has(pkey(g[i].id, g[j].id))) return true;
    return false;
  };
  const ruleBreak = (g: ModePlayer[], activeKeys: Set<string>): string | null => {
    const f = g.filter((p) => p.gender === 'F');
    const m = g.filter((p) => p.gender === 'M');
    if (f.length === 1 && m.length === 3 && f[0].skill <= 4) return '여자 C급 이하는 혼복·여복으로';
    if (g.length === 4 && !hasRequestPair(g, activeKeys)) {
      const sp = levelSpread(g, tune.genderOffsetFemale);
      if (sp > spreadCap) return `급수 폭 ${sp}단계`;
      const gap = mixedGap(g);
      if (gap != null && (gap > 3 || gap < -1)) return `혼복 남녀 급수 차이 ${gap > 0 ? '+' : ''}${gap}`;
    }
    return null;
  };
  const requestHooks = (activeKeys: Set<string>, availableIds: Set<string>): RequestHooks | undefined => {
    const partnerOf = new Map<string, string[]>();
    for (const k of activeKeys) {
      const [x, y] = k.split('|');
      partnerOf.set(x, [...(partnerOf.get(x) ?? []), y]);
      partnerOf.set(y, [...(partnerOf.get(y) ?? []), x]);
    }
    return {
      companions: partnerOf,
      score: (group) => {
        const ids = group.map((p) => p.id);
        const inGroup = new Set(ids);
        let c = ruleBreak(group, activeKeys) ? RULE_COST : 0;
        if (group.length === 4 && !hasRequestPair(group, activeKeys)) {
          if (levelSpread(group, tune.genderOffsetFemale) === 2) c += SPREAD2_COST;
          const f = group.filter((p) => p.gender === 'F');
          const m = group.filter((p) => p.gender === 'M');
          if (f.length === 2 && m.length === 2) {
            // 혼복 팀 균형: (남+여) vs (남+여) 실제 급수 합 차이가 작은 배치 기준.
            const d1 = Math.abs(m[0].skill + f[0].skill - m[1].skill - f[1].skill);
            const d2 = Math.abs(m[0].skill + f[1].skill - m[1].skill - f[0].skill);
            c += 1.5 * Math.min(d1, d2);
            // 여자 E조 이상은 여복이 기본(서로 랠리가 됨) → 그런 혼복은 비용.
            // F조 여자가 든 혼복은 정배 → 가산점(한 판씩 고르는 엔진이 남복으로 받쳐줄 남자를 먼저 써버리지 않게).
            const fCount = f.filter((p) => p.skill <= 1).length;
            if (fCount > 0) c -= 2.5 * fCount;
            else if (gameType === 'same') c += 3;
            // 남녀 차이는 허용하되 2단계를 넘으면 조금씩(남자가 받쳐주는 구조라도 차이가 작을수록 좋음).
            const gap = (m[0].skill + m[1].skill - f[0].skill - f[1].skill) / 2;
            if (gap > 2) c += 0.8 * (gap - 2);
          }
          // 여자 F조끼리 여복은 랠리가 어려움 → 남자가 받쳐주는 혼복 쪽으로(남자 후보가 있으면).
          if (f.length === 4 && f.some((p) => p.skill <= 1)) c += 3;
          // 게임 종류 '골고루'·'혼복 위주' — 혼복은 2:2로(3:1은 덜), '혼복 위주'면 남복·여복에 비용.
          if (gameType !== 'same') {
            if (f.length === 1 || f.length === 3) c += 2;
            if (gameType === 'mixed' && (f.length === 0 || m.length === 0)) c += 3;
          }
        }
        const eff = (p: ModePlayer) => p.skill + (p.gender === 'F' ? tune.genderOffsetFemale : 0);
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++) {
            const k = pkey(ids[i], ids[j]);
            if (apartKeys.has(k)) c += APART_COST;
            if (activeKeys.has(k)) {
              c -= TOGETHER_BONUS + TOGETHER_GAP_COMP * Math.abs(eff(group[i]) - eff(group[j]));
              // 파트너 팀 vs 나머지 두 명 — 급수 합이 비슷한 상대로(대회 파트너 연습이 한쪽으로 기울지 않게).
              if (group.length === 4) {
                const others = group.filter((_, idx) => idx !== i && idx !== j);
                c += 1.5 * Math.abs(eff(group[i]) + eff(group[j]) - others.reduce((sum, p) => sum + eff(p), 0));
              }
            }
          }
        for (const id of ids)
          for (const partner of partnerOf.get(id) ?? [])
            if (!inGroup.has(partner) && availableIds.has(partner)) c += PARTNER_MISSING;
        return c;
      },
    };
  };
  let slotActive = activeTogether();

  // 이유 문구용 — 이번 정모에서 실제로 같은 게임에 들어간 횟수(감쇠 없는 원본).
  const pairCount: Record<string, number> = {};
  for (const g of sessionGames) {
    const ids = g.players.map((p) => p.userId);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pkey(ids[i], ids[j]);
        pairCount[k] = (pairCount[k] ?? 0) + 1;
      }
  }
  const poolNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: poolIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name] as const,
    ),
  );
  const avgGames = modePool.reduce((sum, p) => sum + p.games, 0) / Math.max(1, modePool.length);

  // 왜 이 4명인지 — 운영자가 바로 납득할 수 있게 1줄(최대 100자).
  const buildReason = (ordered: ModePlayer[], at: number): string => {
    const parts: string[] = [];
    // 운영진 요청을 반영한 판이면 맨 앞에 표시.
    for (let i = 0; i < ordered.length; i++)
      for (let j = i + 1; j < ordered.length; j++)
        if (slotActive.has(pkey(ordered[i].id, ordered[j].id)))
          parts.push(`요청: ${poolNames.get(ordered[i].id) ?? ''}·${poolNames.get(ordered[j].id) ?? ''} 파트너`);
    const startsIn = Math.round((at - nowMs) / 60000);
    if (startsIn >= 2) parts.push(`약 ${startsIn}분 뒤 시작`);
    // 운영진 방식(시간 기준) 표시: 코트에서 곧 끝나는 사람 / 앞 판에 이어서 치는 사람.
    const finishing = ordered.filter((p) => playingNowIds.has(p.id)).length;
    const chained = ordered.filter((p) => !playingNowIds.has(p.id) && (availMs.get(p.id) ?? 0) > nowMs).length;
    if (finishing > 0) parts.push(`코트에서 곧 끝나는 ${finishing}명`);
    if (chained > 0) parts.push(`앞 판에 이어서 ${chained}명`);
    const longest = [...ordered].sort((a, b) => b.waitSeconds - a.waitSeconds)[0];
    if (longest && longest.waitSeconds >= 20 * 60) {
      parts.push(`${poolNames.get(longest.id) ?? ''} ${Math.round(longest.waitSeconds / 60)}분 대기`);
    }
    const fewest = [...ordered].sort((a, b) => a.games - b.games)[0];
    if (fewest && fewest.games <= avgGames - 1) parts.push(`${poolNames.get(fewest.id) ?? ''} 오늘 ${fewest.games}판`);
    let repeats = 0;
    for (let i = 0; i < ordered.length; i++)
      for (let j = i + 1; j < ordered.length; j++)
        if ((pairCount[pkey(ordered[i].id, ordered[j].id)] ?? 0) > 0) repeats++;
    parts.push(repeats === 0 ? '오늘 처음 만나는 조합' : `오늘 겹침 ${repeats}쌍`);
    if (ordered.length === 4) {
      const lv = (p: ModePlayer) => NUM_TO_SKILL[p.skill] ?? '?';
      parts.push(`${lv(ordered[0])}${lv(ordered[1])} vs ${lv(ordered[2])}${lv(ordered[3])}`);
    }
    return parts.join(' · ').slice(0, 100);
  };

  // ── 대상 게임 모드(채우기 / 땜빵) ─────────────────────────────────────
  if (target && targetFixed) {
    const fixedIds = new Set(targetFixed);
    const need = 4 - targetFixed.length;
    if (need <= 0) return { suggestions: [], substitutes: [], mode, note: '이미 4명이에요' };
    const eligible = baseIds.filter((id) => !fixedIds.has(id) && !laterIds.has(id));
    // 코트 진행 중 게임의 땜빵은 지금 쉬는 사람만. 대기 게임은 쉬는 사람 우선, 모자라면 그 게임 시작 때 비는 사람.
    const idleNow = eligible.filter(isIdle);
    const useIdle = !!target.turnId || idleNow.length >= need;
    const at = useIdle ? nowMs : targetStart;
    const startAt = target.turnId ? nowMs : targetStart;
    const available = (useIdle ? idleNow : eligible.filter((id) => freeBy(id, targetStart))).map((id) => toModePlayer(id, at));
    const fixedMP = targetFixed.map((id) => toModePlayer(id, at));
    slotActive = activeTogether();
    const baseHooks = requestHooks(slotActive, new Set(available.map((p) => p.id)));
    // 땜빵: 빠지는 사람(없으면 남은 사람들 평균)과 급수가 가까운 사람 우선 — 게임 밸런스 유지.
    let hooks = baseHooks;
    if (target.kind === 'substitute') {
      const effSkill = (p: ModePlayer) => p.skill + (p.gender === 'F' ? tune.genderOffsetFemale : 0);
      const outP = target.outUserId ? toModePlayer(target.outUserId, at) : null;
      const ref = outP ? effSkill(outP) : fixedMP.reduce((sum, p) => sum + effSkill(p), 0) / Math.max(1, fixedMP.length);
      // 같은 성별 우선: 빠진 사람과 성별이 다르면 비용(남복에 여자 1명 → 3:1 혼복은 운영진도 피함).
      const refGender = outP?.gender ?? null;
      hooks = {
        companions: baseHooks?.companions,
        score: (g) => {
          let c = baseHooks?.score ? baseHooks.score(g) : 0;
          for (const p of g) {
            if (fixedIds.has(p.id)) continue;
            c += 3 * Math.abs(effSkill(p) - ref); // 급수 1단계 = 공평 3게임 상당(땜빵은 밸런스 우선)
            if (refGender && p.gender && p.gender !== refGender) c += 4;
          }
          return c;
        },
      };
    }
    // 땜빵은 한 자리 끼우기 — 혼복/동성복 '순환' 항은 끈다(같은 성별·급수가 우선).
    const targetTuning = target.kind === 'substitute' ? { ...tuning, typeVarietyWeight: 0 } : tuning;
    // 규칙(급수 폭·여자 C 이하 3:1) 안 조합만. 채우기는 쉬는 사람으로 안 되면 그 게임 시작 때 비는 사람까지.
    const valid = (pool: ModePlayer[], fixed: ModePlayer[], k: number) => {
      const m = new Map([...pool, ...fixed].map((p) => [p.id, p]));
      return completeGroup(pool, fixed, need, mode, pairWeight, targetTuning, styleScorer, hooks, 12)
        .filter((r) => !ruleBreak(r.playerIds.map((id) => m.get(id)!), slotActive))
        .slice(0, k);
    };
    let ranked = valid(available, fixedMP, target.kind === 'substitute' ? 3 : 1);
    // 땜빵은 이미 진행 중인 판의 급한 빈자리 — 규칙 안 후보가 3명이 안 되면 '덜 나쁜' 규칙 밖 후보도
    // 뒤에 보여준다(표시: ⚠ 급수 차이 큼). 새 게임·채우기는 규칙을 엄격히 지킨다.
    const relaxedIds = new Set<string>();
    if (target.kind === 'substitute' && ranked.length < 3) {
      const have = new Set(ranked.map((r) => r.playerIds.join(',')));
      const extra = completeGroup(available, fixedMP, need, mode, pairWeight, targetTuning, styleScorer, hooks, 12)
        .filter((r) => !have.has(r.playerIds.join(',')))
        .slice(0, 3 - ranked.length);
      for (const r of extra) relaxedIds.add(r.playerIds.find((x) => !fixedIds.has(x))!);
      ranked = [...ranked, ...extra];
    }
    let pool2: ModePlayer[] = [];
    if (ranked.length === 0 && target.kind === 'fill' && useIdle && !target.turnId) {
      pool2 = eligible.filter((id) => freeBy(id, targetStart)).map((id) => toModePlayer(id, targetStart));
      ranked = valid(pool2, targetFixed.map((id) => toModePlayer(id, targetStart)), 1);
    }
    const byId = new Map([...available, ...fixedMP, ...pool2].map((p) => [p.id, p]));
    const names = new Map(
      (await prisma.user.findMany({ where: { id: { in: Array.from(byId.keys()) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    if (target.kind === 'substitute') {
      const substitutes = ranked.map((r) => {
        const id = r.playerIds.find((x) => !fixedIds.has(x))!;
        const p = byId.get(id)!;
        const bits = [`${NUM_TO_SKILL[p.skill] ?? '?'}${p.gender === 'F' ? '·여' : p.gender === 'M' ? '·남' : ''}`];
        if (p.waitSeconds >= 60) bits.push(`${Math.round(p.waitSeconds / 60)}분 대기`);
        bits.push(`오늘 ${p.games}판`);
        if (playingNowIds.has(id)) bits.push('코트에서 곧 끝남');
        if (targetFixed!.some((f) => slotActive.has(pkey(f, id)))) bits.push('파트너 요청');
        if (relaxedIds.has(id)) bits.unshift('⚠ 급수 차이 큼');
        return { userId: id, name: names.get(id) ?? '', reason: bits.join(' · ') };
      });
      return { suggestions: [], substitutes, mode };
    }
    if (ranked.length === 0)
      return {
        suggestions: [],
        mode,
        note: `급수·성별 규칙(급수 폭 ${spreadCap}단계, 여자 C 이하 혼복·여복)에 맞는 사람이 아직 없어요 — 코트에서 나오면 채워요`,
      };
    const ordered = splitTeams(ranked[0].playerIds.map((id) => byId.get(id)!).filter(Boolean), tune.genderOffsetFemale, pairWeight, slotActive);
    return {
      suggestions: [
        {
          playerIds: ordered.map((p) => p.id),
          playerNames: ordered.map((p) => names.get(p.id) ?? ''),
          reason: buildReason(ordered, startAt),
          teamSplit: ordered.length === 4,
          startsInMin: Math.max(0, Math.round((startAt - nowMs) / 60000)),
        },
      ],
      mode,
    };
  }

  // ── 슬롯별 선택: 슬롯 시작 시각에 비는 사람 중 공평+겹침회피+모드+모임 스타일 ──
  const slotPlayerIds: string[][] = [];
  const slotReasons: string[] = [];
  const slotStarts: number[] = [];
  let waitingNote: string | null = null;

  for (let slot = 0; slot < count; slot++) {
    // 쉬는 사람이 4명 이상이면 그들 중에서(지금 기준), 아니면 시간 기준(이 판 시작 시각에 비는 사람).
    const idleIds = poolIds.filter(isIdle);
    slotActive = activeTogether();
    // 후보 시점: 지금 쉬는 사람(4명+면) → 안 되면 코트가 비는 시각들(최대 3개)에 비는 사람.
    // 각 시점에서 규칙(급수 폭·여자 C 이하 3:1 금지) 안 4명이 나오면 그걸로, 끝까지 없으면 이 판은 기다림.
    const attempts: { at: number; ids: string[] }[] = [];
    if (idleIds.length >= 4) attempts.push({ at: nowMs, ids: idleIds });
    const futureStarts = Array.from(new Set([slotStart, ...courtFree.filter((t) => t > slotStart)])).sort((a, b) => a - b).slice(0, 3);
    for (const t of futureStarts) attempts.push({ at: t, ids: poolIds.filter((id) => freeBy(id, t)) });
    let picked: { playerIds: string[] } | null = null;
    let byId = new Map<string, ModePlayer>();
    let chosenAt = slotStart;
    for (const att of attempts) {
      if (att.ids.length < 4) continue;
      const available = att.ids.map((id) => toModePlayer(id, att.at));
      const hooks = requestHooks(slotActive, new Set(available.map((p) => p.id)));
      const pk4 = selectFoursomeByMode(available, mode, pairWeight, 4, undefined, tuning, styleScorer, hooks);
      if (pk4.playerIds.length < 4) continue;
      const m = new Map(available.map((p) => [p.id, p]));
      if (ruleBreak(pk4.playerIds.map((id) => m.get(id)!), slotActive)) continue;
      picked = pk4;
      byId = m;
      chosenAt = Math.max(att.at, slotStart);
      break;
    }
    if (!picked) {
      waitingNote = `급수·성별 규칙(급수 폭 ${spreadCap}단계, 여자 C 이하 혼복·여복)에 맞는 4명이 아직 없어요 — 코트에서 나오면 짜요`;
      break;
    }
    slotStart = chosenAt;

    // 팀까지 짜준다 — 실효 급수 합이 가장 비슷한 2:2(남녀 2:2면 각 팀 남녀 1명씩), 순서 [A1, A2, B1, B2].
    const ordered = splitTeams(
      picked.playerIds.map((id) => byId.get(id)!).filter(Boolean),
      tune.genderOffsetFemale,
      pairWeight,
      slotActive,
    );
    slotPlayerIds.push(ordered.map((p) => p.id));
    slotReasons.push(buildReason(ordered, slotStart));
    slotStarts.push(slotStart);
    // 파트너 요청 판수 진행(이번 호출 다음 슬롯부터 목표 판수 반영).
    for (let i = 0; i < picked.playerIds.length; i++)
      for (let j = i + 1; j < picked.playerIds.length; j++) {
        const k = pkey(picked.playerIds[i], picked.playerIds[j]);
        if (k in togetherSoFar) togetherSoFar[k] += 1;
      }

    // 다음 슬롯을 위해 시뮬레이션 갱신: 이 판이 코트를 차지 → 끝나면 이 4명이 비고, 판수 +1.
    const startAt = Math.max(popEarliest(), slotStart);
    const endAt = startAt + gameMs;
    courtFree.push(endAt);
    addPairWeight(picked.playerIds, nowMs);
    const mixed = ordered.some((p) => p.gender === 'M') && ordered.some((p) => p.gender === 'F');
    for (const id of picked.playerIds) {
      availMs.set(id, endAt);
      extraGames[id] = (extraGames[id] ?? 0) + 1;
      if (mixed) extraMixed[id] = (extraMixed[id] ?? 0) + 1;
      else extraSame[id] = (extraSame[id] ?? 0) + 1;
    }
    slotStart = Math.max(nowMs, Math.min(...courtFree));
  }

  const allIds = Array.from(new Set(slotPlayerIds.flat()));
  const users = await prisma.user.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } });
  const nameMap = new Map(users.map((u) => [u.id, u.name]));

  const suggestions = slotPlayerIds.map((ids, i) => ({
    playerIds: ids,
    playerNames: ids.map((id) => nameMap.get(id) ?? ''),
    reason: slotReasons[i] ?? '',
    teamSplit: ids.length === 4,
    startsInMin: Math.max(0, Math.round((slotStarts[i] - nowMs) / 60000)),
  }));

  return {
    suggestions,
    mode,
    ...(waitingNote ? { note: waitingNote } : {}),
    rules: { spreadCap, femaleOffset: tune.genderOffsetFemale },
    pace: {
      medianGameMin: pace.medianGameMin,
      currentGameMin: Math.round((gameMs / 60000) * 10) / 10,
      personCycleMin: Math.round((tune.gameCycleSeconds / 60) * 10) / 10,
      source: pace.source,
    },
    style: summarizeStyle(style),
  };
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
    groupCounts: composition.groupCounts,
    // 모드2 자석판 위치(운영진 공유). { [userId]: { x, y } } 분수 좌표.
    tagLayout: ((board as { tagLayout?: unknown }).tagLayout as Record<string, { x: number; y: number }>) ?? {},
  };
}

// 모드2 자석판: 한 이름표의 위치를 갱신(운영진 공유). tagLayout JSON 을 read-modify-write
// 하고 소켓으로 다른 운영진에 전파. LEADER/STAFF 만(verifyBoardStaff).
export async function updateTagLayout(
  boardId: string,
  userId: string,
  x: number,
  y: number,
  operatorId: string,
): Promise<{ success: true }> {
  const board = await verifyBoardStaff(boardId, operatorId);
  const layout = { ...((board.tagLayout as unknown as Record<string, { x: number; y: number }>) || {}) };
  layout[userId] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  await prisma.gameBoard.update({ where: { id: boardId }, data: { tagLayout: layout } });
  const io = getIO();
  io.to(`facility:${board.facilityId}`).emit('gameBoard:layoutUpdated', { boardId, userId, x: layout[userId].x, y: layout[userId].y });
  return { success: true };
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
): Promise<{ playedGroups: string[]; pairCounts: Record<string, number>; groupCounts: Record<string, number> }> {
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
  // groupCounts: 4인 조합 key -> 이 정모에서 그 조합이 등장한 게임 수(완료/진행 + 대기열).
  // 대기열 일괄 "중복 점검"에서 어떤 편성이 이미 친/이미 편성된 조합인지 정확히 세는 데 쓴다.
  const groupCounts = new Map<string, number>();

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
      const key = [...ids].sort().join('|');
      playedGroupSet.add(key);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
    addPairs(ids);
  }

  // QUEUED entries: their playerIds also count for the staged "이미 친 조합" check
  // and pairing visibility (they will be played next).
  for (const e of rawEntries) {
    if (e.status !== 'QUEUED') continue;
    const ids = (e.playerIds as string[]) ?? [];
    if (ids.length === 4) {
      const key = [...ids].sort().join('|');
      playedGroupSet.add(key);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
    addPairs(ids);
  }

  return {
    playedGroups: Array.from(playedGroupSet),
    pairCounts: Object.fromEntries(pairCounts),
    groupCounts: Object.fromEntries(groupCounts),
  };
}

// SOFT double-booking data: userIds who are (a) currently in a WAITING/PLAYING
// turn WITHIN THIS 정모 (clubSession), or (b) appear in more than one QUEUED entry
// on this board. Used by the client to flag (small red dot) double-booked players.
// SESSION-scoped on purpose: a player busy in a DIFFERENT 정모 at the same gym is
// not a conflict here. Never a hard block.
async function computeBusyPlayerIds(clubSessionId: string, rawEntries: any[]): Promise<string[]> {
  // A1: a player is "busy" (double-booked → red dot) only when they are
  // committed to 2+ active assignments THIS 정모, i.e.
  //   (number of QUEUED entries containing them)
  //   + (1 if they are in a WAITING/PLAYING court turn) >= 2.
  // A player in just one game (one QUEUED entry, or only a court turn) is NOT
  // flagged. SESSION-scoped: a player busy in a DIFFERENT 정모 isn't a conflict.
  const counts = new Map<string, number>();
  const bump = (pid: string, by = 1) => counts.set(pid, (counts.get(pid) ?? 0) + by);

  // (a) Each QUEUED entry containing the player counts once.
  for (const e of rawEntries) {
    if (e.status !== 'QUEUED') continue;
    for (const pid of e.playerIds as string[]) bump(pid);
  }

  // (b) Being in a WAITING/PLAYING court turn OF THIS 정모 counts once more.
  const inTurn = await prisma.turnPlayer.findMany({
    where: { turn: { clubSessionId, status: { in: ['WAITING', 'PLAYING'] } } },
    select: { userId: true },
  });
  for (const t of inTurn) bump(t.userId);

  const busy: string[] = [];
  for (const [pid, n] of counts) {
    if (n >= 2) busy.push(pid);
  }
  return busy;
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
    teamSplit: !!entry.teamSplit,
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
