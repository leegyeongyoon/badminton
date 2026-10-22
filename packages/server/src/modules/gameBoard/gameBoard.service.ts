import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket';
import { registerTurn } from '../turn/turn.service';
import { sendPushToUser } from '../notification/notification.service';
import {
  selectFoursomeByMode,
  splitTeams,
  resolveTuning,
  SUGGEST_TUNABLES,
  type SuggestMode,
  type ModePlayer,
  type SuggestTuning,
  type StyleScorer,
} from './suggest.algorithm';
import { getClubStyle, styleUtility, type ClubStyle } from './clubStyle';

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

export async function updateEntry(boardId: string, entryId: string, playerIds: string[]) {
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 수정할 수 있습니다');

  const updated = await prisma.gameBoardEntry.update({
    where: { id: entryId },
    // 4명이 아니게 되면 팀 구성([A1,A2,B1,B2]) 의미가 깨지므로 해제. 자리 교체(4명 유지)는 팀 유지.
    data: { playerIds, ...(playerIds.length !== 4 ? { teamSplit: false } : {}) },
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
  opts: { courtId?: string; count?: number; mode?: SuggestMode; exclude?: string[]; tuning?: Partial<SuggestTuning> },
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
    select: { userId: true, restingAt: true, isInLesson: true },
  });

  // Exclusion sets ------------------------------------------------------------
  // Resting users
  const restingIds = new Set(checkins.filter((c) => c.restingAt).map((c) => c.userId));

  // 레슨 중인 사람 — 자동 추천에서 제외(레슨자 박스로 분리, 수동으로만 코트 배정).
  const inLessonIds = new Set(checkins.filter((c) => c.isInLesson).map((c) => c.userId));

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

  // Client-supplied exclusions: players the operator has STAGED in the next-game
  // tray (not yet a QUEUED entry) plus any already-queued upcoming players, so
  // building game-after-game keeps using FRESH people. This is on top of the
  // server-side exclusions above (resting / in-turn / queued / penalized).
  const excludeIds = new Set(opts.exclude ?? []);

  // Build eligible pool --------------------------------------------------------
  const poolIds = checkins
    .map((c) => c.userId)
    .filter(
      (id) =>
        !restingIds.has(id) &&
        !inLessonIds.has(id) &&
        !inTurnIds.has(id) &&
        !queuedIds.has(id) &&
        !penalizedIds.has(id) &&
        !excludeIds.has(id),
    );

  if (poolIds.length < 4) {
    return { suggestions: [] };
  }

  // ── Per-player session data for fairness (games + wait time) ───────────────
  // Games already played this 정모, AND the timestamp of each player's LAST game,
  // so we can compute wait time. A "game played this session" = a GamePlayer row
  // whose Game's CourtTurn belongs to this clubSession. We read each Game's
  // timestamps to derive (a) per-player games count and (b) last-game time.
  const sessionGames = await prisma.game.findMany({
    where: { turn: { clubSessionId } },
    select: {
      // Use the turn's completedAt when available (game actually ended),
      // otherwise the game's own updatedAt/createdAt as the "when it happened".
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
    ? await prisma.playerProfile.findMany({
        where: { userId: { in: gameUserIds } },
        select: { userId: true, gender: true },
      })
    : [];
  const genderOf = new Map(
    gameProfiles.map((p) => [p.userId, p.gender === 'M' || p.gender === 'F' ? p.gender : null] as const),
  );

  const initialGamesCount: Record<string, number> = {};
  const mixedGamesCount: Record<string, number> = {}; // 풀 유저의 혼복 횟수
  const sameGamesCount: Record<string, number> = {}; // 풀 유저의 동성복(남복/여복) 횟수
  for (const pid of poolIds) {
    initialGamesCount[pid] = 0;
    mixedGamesCount[pid] = 0;
    sameGamesCount[pid] = 0;
  }
  // lastGameAt: most recent game time per pool user (ms epoch), 0 if none.
  const lastGameAtMs: Record<string, number> = {};
  for (const g of sessionGames) {
    const t = (g.turn?.completedAt ?? g.turn?.startedAt ?? g.updatedAt ?? g.createdAt);
    const tMs = t ? new Date(t).getTime() : 0;
    // 이 게임이 혼복이었는지(남녀 각 1명 이상) 참가자 성별로 판정.
    let gm = 0;
    let gf = 0;
    for (const gp of g.players) {
      const gg = genderOf.get(gp.userId);
      if (gg === 'M') gm++;
      else if (gg === 'F') gf++;
    }
    const isMixed = gm >= 1 && gf >= 1;
    for (const gp of g.players) {
      if (!(gp.userId in initialGamesCount)) continue; // only pool users
      initialGamesCount[gp.userId] = (initialGamesCount[gp.userId] ?? 0) + 1;
      if (isMixed) mixedGamesCount[gp.userId] = (mixedGamesCount[gp.userId] ?? 0) + 1;
      else sameGamesCount[gp.userId] = (sameGamesCount[gp.userId] ?? 0) + 1;
      if (tMs > (lastGameAtMs[gp.userId] ?? 0)) lastGameAtMs[gp.userId] = tMs;
    }
  }

  // checkedInAt per pool user (arrival time). Wait = now − max(checkedInAt,
  // lastGameAt): early arrivals idling and people just-not-playing both rise; a
  // player who JUST finished a game has wait≈0.
  const checkedInAtMs: Record<string, number> = {};
  const checkinTimes = await prisma.checkIn.findMany({
    where: { clubSessionId, checkedOutAt: null, userId: { in: poolIds } },
    select: { userId: true, checkedInAt: true },
  });
  for (const c of checkinTimes) {
    checkedInAtMs[c.userId] = new Date(c.checkedInAt).getTime();
  }

  const nowMs = now.getTime();
  function waitSecondsFor(id: string): number {
    const lastActivity = Math.max(checkedInAtMs[id] ?? nowMs, lastGameAtMs[id] ?? 0);
    return Math.max(0, (nowMs - lastActivity) / 1000);
  }

  // ── Per-player skill + gender (PlayerProfile is optional) ──────────────────
  const profiles = await prisma.playerProfile.findMany({
    where: { userId: { in: poolIds } },
    select: { userId: true, skillLevel: true, gender: true },
  });
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));

  // PER-CLUB 급수 (모임별 급수): auto-match must use the EFFECTIVE per-club skill,
  // i.e. ClubMember(userId, clubSession.clubId).skillLevel overrides the user's own
  // default. Build an override map for this 정모's club; guests have no row → default.
  const skillOverrides = await prisma.clubMember.findMany({
    where: { clubId: clubSession.clubId, userId: { in: poolIds } },
    select: { userId: true, skillLevel: true },
  });
  const skillOverrideMap = new Map(skillOverrides.map((m) => [m.userId, m.skillLevel]));

  const modePool: ModePlayer[] = poolIds.map((id) => {
    const prof = profileMap.get(id);
    const g = prof?.gender;
    const effectiveSkill = skillOverrideMap.get(id) ?? prof?.skillLevel;
    return {
      id,
      skill: skillToNum(effectiveSkill),
      games: initialGamesCount[id] ?? 0,
      gender: g === 'M' || g === 'F' ? g : null,
      waitSeconds: waitSecondsFor(id),
      timePresentSeconds: Math.max(0, (nowMs - (checkedInAtMs[id] ?? nowMs)) / 1000),
      mixedGames: mixedGamesCount[id] ?? 0,
      sameGames: sameGamesCount[id] ?? 0,
    };
  });
  const poolById = new Map(modePool.map((p) => [p.id, p]));

  // ── Recency-weighted pair history (variety baseline, ALL modes) ────────────
  // Build pairWeight: pairKey → Σ recency-decayed weight of shared games. Recent
  // shared games weigh more (exponential decay by half-life). Includes COMPLETED
  // /IN_PROGRESS games this 정모 AND the pairings implied by staged QUEUED
  // entries (treated as "now", full weight, since they're about to be played).
  const pairWeight: Record<string, number> = {};
  const HL = SUGGEST_TUNABLES.PAIR_RECENCY_HALFLIFE_SECONDS;
  const decay = (whenMs: number): number => {
    if (!whenMs) return 0.25; // unknown-time game: small constant weight
    const ageSec = Math.max(0, (nowMs - whenMs) / 1000);
    return Math.pow(0.5, ageSec / HL);
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
    const t = (g.turn?.completedAt ?? g.turn?.startedAt ?? g.updatedAt ?? g.createdAt);
    addPairWeight(g.players.map((p) => p.userId), t ? new Date(t).getTime() : 0);
  }
  // QUEUED staged entries → about-to-play pairings (full weight = now).
  for (const e of board?.entries ?? []) {
    addPairWeight((e.playerIds as string[]) ?? [], nowMs);
  }

  const mode: SuggestMode = opts.mode ?? 'fair';

  // ── 실데이터 페이스 → 공평 주기 ──────────────────────────────────────
  // '오래 있었는데 적게 친 사람' 판단의 기준(기대 게임 수 = 체류시간 / 1인 주기).
  // 1인 주기 = 클럽의 실제 판당 시간 × max(1, 돌아가는 인원 / (4 × 코트 수)).
  const pace = await getClubPace(clubSession.clubId);
  const sessionCourts = await prisma.court.count({
    where: { clubSessionId, status: { not: 'MAINTENANCE' } },
  });
  const rotatingCount = checkins.filter((c) => !c.restingAt && !c.isInLesson).length;
  const ratio = sessionCourts > 0 ? Math.max(1, rotatingCount / (4 * sessionCourts)) : 1;
  const tuning: Partial<SuggestTuning> = {
    ...opts.tuning,
    gameCycleSeconds: pace.medianGameMin * 60 * ratio,
  };
  const tune = resolveTuning(tuning);

  // ── 모임 학습 스타일 — 이 모임 총무들이 과거에 4명을 어떻게 묶었는지(기록 학습, 12시간 캐시) ──
  const style = await getClubStyle(clubSession.clubId);
  let styleScorer: StyleScorer | undefined;
  if (style) {
    const guestIds = new Set(
      (await prisma.user.findMany({ where: { id: { in: poolIds }, isGuest: true }, select: { id: true } })).map((u) => u.id),
    );
    styleScorer = (group) =>
      styleUtility(
        style,
        group.map((p) => ({ id: p.id, skill: p.skill, gender: p.gender, guest: guestIds.has(p.id) })),
      );
  }

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
  const buildReason = (ordered: ModePlayer[]): string => {
    const parts: string[] = [];
    const longest = [...ordered].sort((a, b) => b.waitSeconds - a.waitSeconds)[0];
    if (longest && longest.waitSeconds >= 20 * 60) {
      parts.push(`${poolNames.get(longest.id) ?? ''} ${Math.round(longest.waitSeconds / 60)}분 대기`);
    }
    const fewest = [...ordered].sort((a, b) => a.games - b.games)[0];
    if (fewest && fewest.games <= avgGames - 1) {
      parts.push(`${poolNames.get(fewest.id) ?? ''} 오늘 ${fewest.games}판`);
    }
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

  // ── Unified scoring selection (EVERY mode = fairness + variety + modeTerm) ──
  // Pick `count` foursomes. After each pick, FEED the chosen pairings back into
  // pairWeight (full weight) and bump games/reset wait for those players, so the
  // next slot ROTATES partners and rebalances fairness — this is the multi-slot
  // analogue of the per-game rotation that drives anti-routine variety.
  let slotPlayerIds: string[][] = [];
  const slotReasons: string[] = [];
  const usedThisCall = new Set<string>();

  for (let slot = 0; slot < count; slot++) {
    const available = modePool.filter((p) => !usedThisCall.has(p.id));
    if (available.length < 4) break;

    const picked = selectFoursomeByMode(available, mode, pairWeight, 4, undefined, tuning, styleScorer);
    if (picked.playerIds.length < 4) break;

    // 팀까지 짜준다 — 실효 급수 합이 가장 비슷한 2:2, 순서 [A1, A2, B1, B2].
    const ordered = splitTeams(
      picked.playerIds.map((id) => poolById.get(id)!).filter(Boolean),
      tune.genderOffsetFemale,
      pairWeight,
    );
    slotPlayerIds.push(ordered.map((p) => p.id));
    slotReasons.push(buildReason(ordered));

    // Feed this foursome back so subsequent slots rotate + rebalance.
    for (const id of picked.playerIds) usedThisCall.add(id);
    addPairWeight(picked.playerIds, nowMs);
    // 이번에 뽑은 판의 타입(혼복/동성복)을 계산해 다음 슬롯이 타입도 순환하게 반영.
    let pm = 0;
    let pf = 0;
    for (const id of picked.playerIds) {
      const mp = poolById.get(id);
      if (mp?.gender === 'M') pm++;
      else if (mp?.gender === 'F') pf++;
    }
    const pickedMixed = pm >= 1 && pf >= 1;
    for (const id of picked.playerIds) {
      const mp = poolById.get(id);
      if (mp) {
        mp.games += 1;
        mp.waitSeconds = 0; // they just got a game
        if (pickedMixed) mp.mixedGames += 1;
        else mp.sameGames += 1;
      }
    }
  }

  // Resolve player names
  const allIds = Array.from(new Set(slotPlayerIds.flat()));
  const users = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(users.map((u) => [u.id, u.name]));

  const suggestions = slotPlayerIds.map((ids, i) => ({
    playerIds: ids,
    playerNames: ids.map((id) => nameMap.get(id) ?? ''),
    reason: slotReasons[i] ?? '',
    teamSplit: ids.length === 4,
  }));

  return {
    suggestions,
    mode,
    pace: {
      medianGameMin: pace.medianGameMin,
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
