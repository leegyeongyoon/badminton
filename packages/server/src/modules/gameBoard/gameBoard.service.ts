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
  priorityCost,
  SUGGEST_TUNABLES,
  GENDER_SKILL_OFFSET_FEMALE,
  type SuggestMode,
  type ModePlayer,
  type SuggestTuning,
  type StyleScorer,
  type RequestHooks,
} from './suggest.algorithm';
import { getClubStyle, styleUtility, type ClubStyle, DEFAULT_SPREAD_CAP } from './clubStyle';
import { activeRequestsForEngine } from './sessionRequest.service';
import { resolveAutoSettings } from './autoSettings';
import { recordAutoEdit } from './feedback.service';
import { getDurationModel, predictGameMin, normalizeFormat, type DurationPlayer } from './gameDuration';

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
        -- 정모 종료로 강제로 끝난 판(시작+20분 상한)은 실제 경기 시간이 아님.
        AND (cs."endedAt" IS NULL OR ct."completedAt" < cs."endedAt" - interval '30 seconds')
        AND ABS(EXTRACT(EPOCH FROM (ct."completedAt" - ct."startedAt")) - 1200) > 1
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
  return {
    decisions: style.decisions,
    editSamples: style.editSamples,
    testAccuracy: style.testAccuracy,
    traits: style.traits,
    trainedAt: style.trainedAt,
  };
}

// 정모 기준 페이스 — 클럽 페이스 + 1인당 한 판 주기(판당 시간 × 인원/(4×코트)).
// 오늘 현황 — 시작된 판 + 대기 게임(4명). 운영판 'AI 편성 설정' 옆에 실제 값으로 보여준다:
// 혼복 판수, 급수 차이별 판수(0·1·2·3+단계), 지금 있는 사람 판수(최소·최대), 급수·성별별 인원.
async function computeTodayStats(clubSessionId: string, clubId: string) {
  const [games, entries, checkins] = await Promise.all([
    prisma.game.findMany({ where: { turn: { clubSessionId } }, select: { players: { select: { userId: true } } } }),
    prisma.gameBoardEntry.findMany({ where: { board: { clubSessionId }, status: 'QUEUED' }, select: { playerIds: true } }),
    prisma.checkIn.findMany({ where: { clubSessionId, checkedOutAt: null }, select: { userId: true } }),
  ]);
  const groups = [
    ...games.map((g) => g.players.map((p) => p.userId)),
    ...entries.map((e) => (e.playerIds as string[]) ?? []),
  ];
  const presentIds = checkins.map((c) => c.userId);
  const ids = Array.from(new Set([...groups.flat(), ...presentIds]));
  const [profiles, overrides] = await Promise.all([
    prisma.playerProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, gender: true, skillLevel: true } }),
    prisma.clubMember.findMany({ where: { clubId, userId: { in: ids } }, select: { userId: true, skillLevel: true } }),
  ]);
  const ov = new Map(overrides.map((o) => [o.userId, o.skillLevel] as const));
  const info = new Map(
    profiles.map((p) => [
      p.userId,
      { gender: p.gender === 'M' || p.gender === 'F' ? (p.gender as 'M' | 'F') : null, skill: skillToNum(ov.get(p.userId) ?? p.skillLevel) },
    ] as const),
  );
  const pl = (id: string) => (info.get(id) ?? { gender: null, skill: 4 }) as ModePlayer;
  let mixed = 0;
  let total = 0;
  const spread = [0, 0, 0, 0];
  const played: Record<string, number> = {};
  for (const g of groups) {
    for (const id of g) played[id] = (played[id] ?? 0) + 1;
    if (g.length !== 4) continue;
    total++;
    const ps = g.map(pl);
    if (ps.some((p) => p.gender === 'M') && ps.some((p) => p.gender === 'F')) mixed++;
    spread[Math.min(3, levelSpread(ps, GENDER_SKILL_OFFSET_FEMALE))]++;
  }
  const counts = presentIds.map((id) => played[id] ?? 0);
  const levelCounts: Record<string, number> = {};
  for (const id of presentIds) {
    const p = info.get(id);
    if (!p?.gender) continue;
    const k = `${p.gender}${NUM_TO_SKILL[Math.min(7, Math.max(1, p.skill))]}`;
    levelCounts[k] = (levelCounts[k] ?? 0) + 1;
  }
  return {
    mixToday: { mixed, total },
    spreadToday: spread, // [같은 급수, 1단계, 2단계, 3단계+] 판수
    gamesToday: counts.length ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
    levelCounts,
  };
}

export async function getSessionPace(clubSessionId: string) {
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { clubId: true, startedAt: true, gameFormat: true },
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
  const today = await computeTodayStats(clubSessionId, session.clubId);
  // 경기 방식 + 코트별 끝날 예상 시각(이 4명·이 방식 예측) — 운영판 '약 N분 남음'.
  const format = normalizeFormat(session.gameFormat);
  const model = await getDurationModel(session.clubId);
  const formatRatio = model.typical[format] / Math.max(1, model.typical['21']);
  const playing = await prisma.courtTurn.findMany({
    where: { clubSessionId, status: 'PLAYING', startedAt: { not: null } },
    select: { courtId: true, startedAt: true, players: { select: { userId: true } } },
  });
  const pIds = playing.flatMap((t) => t.players.map((p) => p.userId));
  const [pProf, pOv] = await Promise.all([
    prisma.playerProfile.findMany({ where: { userId: { in: pIds } }, select: { userId: true, skillLevel: true, gender: true } }),
    prisma.clubMember.findMany({ where: { clubId: session.clubId, userId: { in: pIds } }, select: { userId: true, skillLevel: true } }),
  ]);
  const ovMap = new Map(pOv.map((o) => [o.userId, o.skillLevel] as const));
  const profMap = new Map(pProf.map((p) => [p.userId, p] as const));
  const courtEtas = playing.map((t) => {
    const ps = t.players.map((p) => {
      const pr = profMap.get(p.userId);
      return {
        skill: skillToNum(ovMap.get(p.userId) ?? pr?.skillLevel),
        gender: pr?.gender === 'M' || pr?.gender === 'F' ? (pr.gender as 'M' | 'F') : null,
      };
    });
    const st = t.startedAt!.getTime();
    const min = predictGameMin(model, ps, format, st - session.startedAt.getTime() < 60 * 60 * 1000);
    return { courtId: t.courtId, predictedMin: Math.round(min * 10) / 10, endsAt: new Date(st + min * 60000).toISOString() };
  });
  return {
    ...pace,
    ...today,
    gameFormat: format,
    // 방식별 이 모임 보통 판 예상(분) + 예측 근거(완료된 판 수).
    formatMinutes: model.typical,
    durationSample: model.sample,
    courtEtas,
    // 지금 시점에 맞는 판당 시간 — 정모 첫 1시간은 더 길게, 경기 방식 배율 반영.
    currentGameMin: Math.round((elapsedMin < 60 ? pace.firstHourGameMin : pace.laterGameMin) * formatRatio * 10) / 10,
    style: summarizeStyle(style),
    courts,
    rotatingPlayers: rotating,
    // 한 사람이 다음 판까지 걸리는 평균 주기(분) — 판당 시간 × 대기 비율.
    personCycleMin: Math.round(pace.medianGameMin * ratio * 10) / 10,
  };
}

// 경기 방식(21/25/15점) — 운영진이 정모마다 정한다. 판 시간 예측·코트 남은 시간에 바로 반영.
export async function setGameFormat(clubSessionId: string, userId: string, format: '21' | '25' | '15') {
  const session = await prisma.clubSession.findUnique({ where: { id: clubSessionId }, select: { clubId: true } });
  if (!session) throw new NotFoundError('클럽 세션');
  const member = await prisma.clubMember.findUnique({ where: { userId_clubId: { userId, clubId: session.clubId } } });
  if (!member || member.role === 'MEMBER') throw new ForbiddenError('경기 방식은 대표/운영진만 바꿀 수 있어요');
  await prisma.clubSession.update({ where: { id: clubSessionId }, data: { gameFormat: format } });
  return { gameFormat: format };
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
  await verifyBoardStaff(boardId, userId);
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
      // 팀까지 짜인 4명 = 자동 편성(AI)이 짠 게임 — 운영진이 고쳤는지 나중에 비교.
      aiPlayerIds: teamSplit && playerIds.length === 4 ? playerIds : [],
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

// 늦게 온 사람 반영 — 자동 편성이 매 패스 전에 부른다.
// AI가 짠 뒤 손대지 않은 대기 게임 중 '지금 코트에서 치는 사람이 그대로 이어서 들어가는' 판이,
// 그 판을 짠 뒤에 새로 체크인한 사람이 있고 지금 아무 일정 없이 쉬는 사람이 4명 이상이면 지운다
// (자동 편성이 바로 다시 짠다). 처음 20명일 때 짠 '연속 출전' 판이, 20명이 더 온 뒤에도 그대로 남아
// 방금 끝난 사람이 쉬지도 못하고 다시 들어가고 0게임인 사람은 기다리던 문제(실운영 2026-10-27).
// 다시 짠 판은 마지막 체크인보다 나중에 만들어지므로 같은 판을 반복해서 지우지 않는다.
// 운영진이 지운 게 아니라서 AI 학습 기록(AutoMatchEdit)은 남기지 않는다.
export async function replanStaleQueue(clubSessionId: string, userId: string) {
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { where: { status: 'QUEUED' }, orderBy: { queueOrder: 'asc' } } },
  });
  if (!board) return { removed: 0 };
  await verifyBoardStaff(board.id, userId);
  const [checkins, playing] = await Promise.all([
    prisma.checkIn.findMany({
      where: { clubSessionId, checkedOutAt: null },
      select: { userId: true, checkedInAt: true, restingAt: true, isInLesson: true },
    }),
    prisma.turnPlayer.findMany({
      where: { turn: { clubSessionId, status: { in: ['PLAYING', 'WAITING'] } } },
      select: { userId: true },
    }),
  ]);
  const onCourt = new Set(playing.map((p) => p.userId));
  const queuedIds = new Set(board.entries.flatMap((e) => (e.playerIds as string[]) ?? []));
  const idle = checkins.filter((c) => !c.restingAt && !c.isInLesson && !onCourt.has(c.userId) && !queuedIds.has(c.userId));
  if (idle.length === 0) return { removed: 0 };
  const untouchedAi = (e: (typeof board.entries)[number]) => {
    const ids = (e.playerIds as string[]) ?? [];
    return e.aiPlayerIds.length === 4 && ids.length === 4 && e.aiPlayerIds.every((id) => ids.includes(id));
  };
  // ① 늦게 온 사람: 마지막 체크인 전에 짠 '연속 출전' 판(쉬는 사람이 4명 이상일 때).
  const lastArrival = Math.max(...checkins.map((c) => c.checkedInAt.getTime()));
  const lateArrival = (e: (typeof board.entries)[number]) =>
    idle.length >= 4 && e.createdAt.getTime() < lastArrival && ((e.playerIds as string[]) ?? []).some((id) => onCourt.has(id));
  // ② 빠진 사람: 짜둔 판 없이 20분 넘게 기다린 사람이 있으면, 그 사람이 20분을 넘기 전에 짠 판을 다시 짠다.
  //    (대기 게임을 많이 미리 짜두면 앞에서 한 번 빠진 사람 — 예: 남S 3명 중 1명 — 이 판이 다 빌 때까지
  //    0게임으로 기다리던 문제. 넘은 뒤에 짠 판은 이미 그 사람을 알고 짠 것이라 다시 안 짠다 → 반복 없음.)
  const LEFT_OUT_MS = 20 * 60 * 1000;
  const lastEnds = await prisma.courtTurn.findMany({
    where: { clubSessionId, status: 'COMPLETED', players: { some: { userId: { in: idle.map((c) => c.userId) } } } },
    select: { completedAt: true, players: { select: { userId: true } } },
  });
  const lastEnd = new Map<string, number>();
  for (const t of lastEnds)
    for (const p of t.players) {
      const at = t.completedAt?.getTime() ?? 0;
      if (at > (lastEnd.get(p.userId) ?? 0)) lastEnd.set(p.userId, at);
    }
  const nowMs = Date.now();
  const crossAts = idle
    .map((c) => Math.max(c.checkedInAt.getTime(), lastEnd.get(c.userId) ?? 0) + LEFT_OUT_MS)
    .filter((at) => at <= nowMs);
  const leftOutBefore = crossAts.length ? Math.max(...crossAts) : 0;
  const stale = board.entries.filter((e) => untouchedAi(e) && (lateArrival(e) || e.createdAt.getTime() < leftOutBefore));
  if (stale.length === 0) return { removed: 0 };
  await prisma.gameBoardEntry.deleteMany({ where: { id: { in: stale.map((e) => e.id) }, status: 'QUEUED' } });
  const io = getIO();
  for (const e of stale) io.to(`facility:${board.facilityId}`).emit('gameBoard:entryRemoved', { entryId: e.id, boardId: board.id });
  return { removed: stale.length };
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
  userId: string,
  extra: { note?: string | null; teamSplit?: boolean } = {},
) {
  await verifyBoardStaff(boardId, userId);
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
      // AI가 빈자리를 채운 경우(🤖 채우기) — 채운 4명을 AI 안으로 기록.
      ...(extra.teamSplit === true && playerIds.length === 4 ? { aiPlayerIds: playerIds } : {}),
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

export async function deleteEntry(boardId: string, entryId: string, userId: string) {
  await verifyBoardStaff(boardId, userId);
  const entry = await prisma.gameBoardEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.boardId !== boardId) throw new NotFoundError('게임 편성');
  if (entry.status !== 'QUEUED') throw new BadRequestError('편성된 상태에서만 삭제할 수 있습니다');

  await prisma.gameBoardEntry.delete({ where: { id: entryId } });
  if (entry.aiPlayerIds.length === 4) {
    const b = await prisma.gameBoard.findUnique({ where: { id: boardId }, select: { clubSessionId: true, clubSession: { select: { clubId: true } } } });
    if (b) await recordAutoEdit(entry, b.clubSession.clubId, b.clubSessionId, 'DELETED');
  }

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
  await verifyBoardStaff(boardId, userId);
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
  // AI가 짠 게임이면 그대로 쳤는지/운영진이 고쳤는지 기록(학습용).
  await recordAutoEdit(entry, board.clubSession.clubId, board.clubSessionId, 'PLAYED');

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
      /** 혼복 비율 목표(0~100%) — 주면 gameType 대신 오늘 전체 판의 혼복 비율을 이 값에 맞춘다. */
      mixedRatio?: number;
      avoidRepeat?: 'normal' | 'strong';
    };
    /**
     * 대상 게임 모드(운영진 방식):
     *  · fill: 대기 게임(entryId)에 이미 들어간 1~3명은 고정, 나머지 자리를 채움("한두 명 먼저 넣고 나중에 채우기")
     *  · substitute: 땜빵 — 대기 게임(entryId) 또는 코트 진행 중 게임(turnId)에서 outUserId(선택)를 뺀
     *    나머지를 고정하고 빈 1자리 후보를 점수순 3명 추천
     */
    target?: { kind: 'fill' | 'substitute'; entryId?: string; turnId?: string; outUserId?: string };
    /** false면 1시간 같이 짜기 끔(한 판씩). */
    lookahead?: boolean;
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
  // 경기 방식(21/25/15점) + 판마다 예상 시간 — 이 4명·이 방식·정모 첫 1시간 여부로 예측(gameDuration.ts).
  const sessionFormat = normalizeFormat(clubSession.gameFormat);
  const durModel = await getDurationModel(clubSession.clubId);
  const formatRatio = durModel.typical[sessionFormat] / Math.max(1, durModel.typical['21']);
  // 공평 주기(1인당 한 판 주기)의 기준 — 모임 평균 판 시간 × 경기 방식 배율.
  const gameMs = (elapsedMin < 60 ? pace.firstHourGameMin : pace.laterGameMin) * formatRatio * 60 * 1000;
  const sessionStartAt = clubSession.startedAt.getTime();
  const predictMs = (players: DurationPlayer[], startAt: number) =>
    predictGameMin(durModel, players, sessionFormat, startAt - sessionStartAt < 60 * 60 * 1000) * 60 * 1000;

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
  // 대기 게임(②에서 시뮬레이션) — 판 시간 예측에 필요한 급수·성별을 진행 중 게임과 함께 한 번에 읽는다.
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { where: { status: 'QUEUED' }, select: { id: true, playerIds: true, queueOrder: true } } },
  });
  const queued = [...(board?.entries ?? [])].sort((a, b) => a.queueOrder - b.queueOrder);
  const simIds = Array.from(
    new Set([...courts.flatMap((c) => (c.turns[0]?.players ?? []).map((p) => p.userId)), ...queued.flatMap((e) => (e.playerIds as string[]) ?? [])]),
  );
  const [simProfiles, simOverrides] = await Promise.all([
    prisma.playerProfile.findMany({ where: { userId: { in: simIds } }, select: { userId: true, skillLevel: true, gender: true } }),
    prisma.clubMember.findMany({ where: { clubId: clubSession.clubId, userId: { in: simIds } }, select: { userId: true, skillLevel: true } }),
  ]);
  const simOv = new Map(simOverrides.map((o) => [o.userId, o.skillLevel] as const));
  const simInfo = new Map(
    simProfiles.map((p) => [
      p.userId,
      { skill: skillToNum(simOv.get(p.userId) ?? p.skillLevel), gender: p.gender === 'M' || p.gender === 'F' ? (p.gender as 'M' | 'F') : null },
    ] as const),
  );
  const durOf = (ids: string[]): DurationPlayer[] => ids.map((id) => simInfo.get(id) ?? { skill: 4, gender: null });
  const availMs = new Map<string, number>(); // 확정 일정(진행·대기 게임)이 끝나는 시각
  const committedGames: Record<string, number> = {}; // 대기 게임으로 잡힌 판수
  const courtFree: number[] = [];
  for (const c of courts) {
    const playing = c.turns[0];
    if (playing?.startedAt) {
      const st = playing.startedAt.getTime();
      const end = Math.max(nowMs + 60 * 1000, st + predictMs(durOf(playing.players.map((p) => p.userId)), st));
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
  // 대기 게임 배치용: 선수가 아직 앞 판을 치는 중이면(ready가 나중) 지금 빈 코트를 잡고 기다리지 않는다 —
  // ready 전에 비는 코트 중 가장 늦게 비는 코트를 쓴다(없으면 가장 먼저 비는 코트). 그래야 뒤 대기 게임이
  // 빈 코트에 바로 들어간다(운영판 자동 투입도 막힌 판을 건너뛰고 다 쉬는 판을 먼저 넣는다).
  const popFor = (ready: number) => {
    let best = -1;
    for (let j = 0; j < courtFree.length; j++)
      if (courtFree[j] <= ready && (best < 0 || courtFree[j] > courtFree[best])) best = j;
    if (best < 0) return popEarliest();
    return courtFree.splice(best, 1)[0];
  };

  // ② 이미 짠 대기 게임을 순서대로 코트에 배치
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
    const ready = Math.max(nowMs, ...ids.map((id) => availMs.get(id) ?? nowMs));
    const start = Math.max(popFor(ready), ready);
    const end = start + (ids.length === 4 ? predictMs(durOf(ids), start) : gameMs);
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
  const gameUserIds = Array.from(
    new Set([...sessionGames.flatMap((g) => g.players.map((p) => p.userId)), ...queued.flatMap((e) => (e.playerIds as string[]) ?? [])]),
  );
  const gameProfiles = gameUserIds.length
    ? await prisma.playerProfile.findMany({ where: { userId: { in: gameUserIds } }, select: { userId: true, gender: true, skillLevel: true } })
    : [];
  // 오늘 판의 급수 폭(2단계 차이 판 비율 조절용) — 모임별 급수가 우선.
  const gameSkillOverride = new Map(
    (
      await prisma.clubMember.findMany({
        where: { clubId: clubSession.clubId, userId: { in: gameUserIds } },
        select: { userId: true, skillLevel: true },
      })
    ).map((m) => [m.userId, m.skillLevel] as const),
  );
  const gameSkillOf = new Map(gameProfiles.map((p) => [p.userId, skillToNum(gameSkillOverride.get(p.userId) ?? p.skillLevel)] as const));
  const genderOf = new Map(
    gameProfiles.map((p) => [p.userId, p.gender === 'M' || p.gender === 'F' ? p.gender : null] as const),
  );
  const playedGames: Record<string, number> = {};
  const mixedGamesCount: Record<string, number> = {};
  const sameGamesCount: Record<string, number> = {};
  const lastEndMs: Record<string, number> = {}; // 끝난 게임의 종료 시각(진행 중은 availMs가 담당)
  // 오늘 혼복 비율(목표 비율 조절용) — 시작된 판 + 대기 게임, 이번 호출에서 짠 판은 아래 슬롯에서 더한다.
  let mixSoFar = 0;
  let gamesSoFar = 0;
  let spread2SoFar = 0; // 2단계 차이 판 수(오늘)
  const isMixedIds = (ids: string[]) => ids.some((id) => genderOf.get(id) === 'M') && ids.some((id) => genderOf.get(id) === 'F');
  for (const ids of [...sessionGames.map((g) => g.players.map((p) => p.userId)), ...queued.map((e) => (e.playerIds as string[]) ?? [])]) {
    if (ids.length !== 4) continue;
    gamesSoFar++;
    if (isMixedIds(ids)) mixSoFar++;
    const asPlayers = ids.map((id) => ({ gender: genderOf.get(id) ?? null, skill: gameSkillOf.get(id) ?? 4 }) as ModePlayer);
    if (levelSpread(asPlayers, GENDER_SKILL_OFFSET_FEMALE) >= 2) spread2SoFar++;
  }
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
  // 대기 게임에 이미 잡힌 판도 사람별 혼복/남복·여복 횟수에 넣는다(급수별 혼복 비율이 대기 게임을 무시하고
  // 같은 사람을 혼복으로 계속 미는 것 방지 — 알고리즘 검토 2026-10-27).
  for (const e of queued) {
    const ids = (e.playerIds as string[]) ?? [];
    if (ids.length !== 4) continue;
    const mixed = isMixedIds(ids);
    for (const id of ids) {
      if (mixed) mixedGamesCount[id] = (mixedGamesCount[id] ?? 0) + 1;
      else sameGamesCount[id] = (sameGamesCount[id] ?? 0) + 1;
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

  // ── AI 편성 설정(모임 단위, 운영판 'AI 편성 설정') — 저장된 게 있으면 그것, 없으면 예전 앱이 보낸
  //    prefs, 둘 다 없으면 기본값. 아주 예전 앱(mode만)은 저장된 설정이 없을 때만 예전 방식 그대로.
  const savedSettings = (
    await prisma.club.findUnique({ where: { id: clubSession.clubId }, select: { autoMatchSettings: true } })
  )?.autoMatchSettings;
  const prefs = opts.prefs;
  const useSettings = savedSettings != null || !prefs?.gameType || prefs?.mixedRatio != null || !opts.mode;
  const settings = resolveAutoSettings(
    savedSettings ?? (prefs ? { levelMatch: prefs.levelMatch, mixedRatio: prefs.mixedRatio, avoidRepeat: prefs.avoidRepeat } : null),
  );
  const levelMatch = useSettings ? settings.levelMatch : prefs?.levelMatch ?? 'normal';
  // 혼복 비율(0~1) — 오늘 전체 판의 혼복 비율을 목표에 맞춘다(운영진이 직접 정함).
  const mixTarget = useSettings ? settings.mixedRatio / 100 : null;
  const gameType = mixTarget != null ? 'ratio' : prefs?.gameType ?? 'same';
  // 2단계 차이 판 최대 비율(0~1). tight는 아예 금지(spreadCap 1).
  const spread2Max = useSettings ? settings.spread2MaxPct / 100 : levelMatch === 'loose' ? 0.3 : 0.1;
  const avoidRepeat = useSettings ? settings.avoidRepeat : prefs?.avoidRepeat ?? 'normal';
  // 급수·성별별 설정(같이 칠 범위·혼복 비율·판수 비중) — 키 'M'|'F' + 급수 글자.
  const levelKey = (p: { gender: 'M' | 'F' | null; skill: number }) =>
    p.gender ? `${p.gender}${NUM_TO_SKILL[Math.min(7, Math.max(1, p.skill))]}` : null;
  const levelSetting = (p: { gender: 'M' | 'F' | null; skill: number }) => {
    const k = levelKey(p);
    return useSettings && k ? settings.levels[k] : undefined;
  };
  // 선수별 고정 정보 + 슬롯 시각 기준으로 계산되는 공평 정보.
  const extraGames: Record<string, number> = {}; // 이번 호출에서 미리 짠 판수(다음 슬롯 공평 반영)
  const extraMixed: Record<string, number> = {};
  const extraSame: Record<string, number> = {};
  const gamesWeight = (id: string) => {
    const prof = profileMap.get(id);
    const g = prof?.gender === 'M' || prof?.gender === 'F' ? prof.gender : null;
    const w = levelSetting({ gender: g, skill: skillToNum(skillOverrideMap.get(id) ?? prof?.skillLevel) })?.games;
    return w === 'more' ? 1.25 : w === 'less' ? 0.8 : 1;
  };
  const toModePlayer = (id: string, at: number): ModePlayer => {
    const prof = profileMap.get(id);
    const g = prof?.gender;
    const checkin = checkedInAtMs[id] ?? at;
    const lastActivity = Math.max(checkin, lastEndMs[id] ?? 0, availMs.get(id) ?? 0);
    return {
      id,
      skill: skillToNum(skillOverrideMap.get(id) ?? prof?.skillLevel),
      // 판수 비중(급수별 설정): '많이'는 실제보다 적게 친 것처럼, '적게'는 많이 친 것처럼 봐서 차례를 조절.
      games: ((playedGames[id] ?? 0) + (committedGames[id] ?? 0) + (extraGames[id] ?? 0)) / gamesWeight(id),
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
  // 급수가 높을수록(또는 낮을수록) 비슷한 급수 사람이 적어 같은 사람과 다시 치는 게 자연스럽다 →
  // 오늘 비슷한 급수(보정 ±1단계) 상대가 적은 사람끼리는 겹침 회피를 약하게(10명 이상이면 그대로).
  const effNow = new Map(modePool.map((p) => [p.id, p.skill + (p.gender === 'F' ? GENDER_SKILL_OFFSET_FEMALE : 0)] as const));
  const peerScale = new Map(
    modePool.map((p) => {
      const e = effNow.get(p.id)!;
      let peers = 0;
      for (const q of modePool) if (q.id !== p.id && Math.abs(effNow.get(q.id)! - e) <= 1) peers++;
      return [p.id, Math.min(1, Math.max(0.3, peers / 10))] as const;
    }),
  );
  const pairScale = (a: string, b: string) => ((peerScale.get(a) ?? 1) + (peerScale.get(b) ?? 1)) / 2;
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
        pairWeight[k] = (pairWeight[k] ?? 0) + w * pairScale(ids[i], ids[j]);
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
  let prefTuning: Partial<SuggestTuning> = {};
  if (useSettings || prefs) {
    mode = 'similar';
    prefTuning = {
      levelWeight: levelMatch === 'tight' ? 2.5 : spread2Max >= 0.3 ? 0 : style ? 0.5 : 1.5,
      varietyWeight: avoidRepeat === 'strong' ? 3 : 1,
      sameGenderWeight: gameType === 'same' ? 1.5 : gameType === 'even' ? 0.8 : 0,
      // 혼복 비율 모드는 아래 비율 조절 항이 남복·여복/혼복을 정하므로 동성 가중·순환은 끔.
      typeVarietyWeight: gameType === 'even' ? 0.6 : 0,
    };
  }
  const tuning: Partial<SuggestTuning> = { ...opts.tuning, ...prefTuning, gameCycleSeconds: (gameMs / 1000) * ratio };
  const tune = resolveTuning(tuning);
  let styleScorer: StyleScorer | undefined;
  // 학습 스타일은 운영진 평소 방식(남복·여복 위주)을 담고 있어, 운영자가 게임 종류를 바꿨으면 끈다.
  if (style && (gameType === 'same' || gameType === 'ratio')) {
    const guestIds = new Set(
      (await prisma.user.findMany({ where: { id: { in: poolIds }, isGuest: true }, select: { id: true } })).map((u) => u.id),
    );
    styleScorer = (group) =>
      styleUtility(
        style,
        group.map((p) => ({ id: p.id, skill: p.skill, gender: p.gender, guest: guestIds.has(p.id) })),
        { skipGender: gameType === 'ratio' },
      );
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
  // 운영진이 AI 설정을 쓰면 그 설정이 이긴다(모임 기록 p95가 1이어도 '넉넉하게'면 2단계 허용). 예전 앱만 기록 상한.
  const spreadCap = levelMatch === 'tight' ? 1 : useSettings ? 2 : Math.min(style?.spreadCap ?? DEFAULT_SPREAD_CAP, 2);
  // 2단계 차이 판 — 운영진이 정한 최대 비율(spread2Max) 안이면 약한 비용(1단계 이하가 있으면 그쪽),
  // 넘으면 큰 비용 + 잠깐 기다려 더 나은 판을 찾는다(softIssue).
  const SPREAD2_COST = spread2Max >= 0.3 ? 0.5 : 1.5;
  const SPREAD2_OVER_COST = 12;
  const spread2Over = () => spread2SoFar + 1 > spread2Max * (gamesSoFar + 1) + 0.5;
  // 게임 수 맞추기(판수 차이 최대 N판) — 늦게 온 분은 온 시간만큼 친 걸로 보정. 슬롯 시각마다 기준 갱신.
  const GAP_COST = 15;
  const gameGap = settings.gameBalance === 'auto' || !useSettings ? null : Number(settings.gameBalance.slice(3));
  const sessionStartMs = clubSession.startedAt.getTime();
  let gapAt = nowMs;
  let gapMin = 0;
  const adjGames = (p: ModePlayer) =>
    p.games + Math.max(0, (gapAt - sessionStartMs) / 1000 - p.timePresentSeconds) / Math.max(60, tune.gameCycleSeconds);
  const gapOver = (p: ModePlayer) => gameGap != null && adjGames(p) + 1 - gapMin > gameGap + 0.5;
  // 판수 차이의 기준(가장 적게 친 쪽) — 맨 아래 한 명이 아니라 하위 15% 지점. 레슨·휴식 다녀온 한 명 때문에
  // 나머지 전원이 '판수 초과'로 막히지 않게(알고리즘 검토 2026-10-27).
  const robustMin = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.15))];
  };
  // 밀린 사람 — 이 시점 후보들의 평균 차례 비용보다 0.75판 이상 덜 친 사람. 이런 사람이 든 판은 혼복 비율 같은
  // 선호가 차례를 이기지 못하게 한다(작은 모임에서 여자 2명이 혼복 비율 때문에 계속 밀리던 문제). 시점마다 갱신.
  let fairRef = 0;
  const setFairRef = (ps: ModePlayer[]) => {
    fairRef = ps.length ? ps.reduce((a, p) => a + priorityCost(p, tune.gameCycleSeconds), 0) / ps.length : 0;
  };
  const isOwed = (p: ModePlayer) => priorityCost(p, tune.gameCycleSeconds) <= fairRef - 0.75;
  const RULE_COST = 500;
  const MIX_RATIO_COST = 8;
  const effOf = (p: ModePlayer) => p.skill + (p.gender === 'F' ? tune.genderOffsetFemale : 0);
  // 혼복 2:2의 남녀 급수 관계: 남자가 여자보다 최대 3단계 높아도 됨(남자가 받쳐주는 구조, 여자 F조가
  // 혼복으로 자주 들어가는 이유). 여자가 남자보다 높은 건 보정 급수로 1단계까지(실제 급수 3단계). (운영진 피드백 2026-10-24)
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
    // '같이 안 짜기' 요청은 금지(비용만이면 4명뿐인 시점·땜빵 차선 후보에서 깨질 수 있음).
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (apartKeys.has(pkey(g[i].id, g[j].id))) return '같이 안 짜기 요청';
    if (g.length === 4 && !hasRequestPair(g, activeKeys)) {
      // 급수별 '같이 칠 범위'(같은 성별 기준 위·아래 몇 단계) — 운영진 설정.
      for (const p of g) {
        const ls = levelSetting(p);
        if (!ls || (ls.up == null && ls.down == null)) continue;
        for (const q of g) {
          if (q === p || q.gender !== p.gender) continue;
          if (ls.up != null && q.skill - p.skill > ls.up) return '급수별 같이 칠 범위';
          if (ls.down != null && p.skill - q.skill > ls.down) return '급수별 같이 칠 범위';
        }
      }
      const sp = levelSpread(g, tune.genderOffsetFemale);
      if (sp > spreadCap) return `급수 폭 ${sp}단계`;
      const gap = mixedGap(g);
      // 여자 쪽 상한은 보정 급수(여자 2단계 후함)로 1단계까지 = 실제 급수로 3단계(여 A + 남 C는 실력이 맞는 혼복).
      if (gap != null && (gap > 3 || gap < -3)) return `혼복 남녀 급수 차이 ${gap > 0 ? '+' : ''}${gap}`;
    }
    return null;
  };
  // 아쉬운 판 — 규칙 위반은 아니지만 더 나은 판을 위해 잠깐 기다려볼 만한 경우.
  // 반환값 = 아쉬운 정도(0이면 문제없음). 끝까지 문제없는 판이 없으면 가장 덜 아쉬운 시점의 판을 고른다.
  const softIssue = (g: ModePlayer[], activeKeys: Set<string>): number => {
    if (g.length !== 4 || hasRequestPair(g, activeKeys)) return 0;
    let sev = 0;
    if (levelSpread(g, tune.genderOffsetFemale) >= 2 && spread2Over()) sev += 3;
    sev += 2 * g.filter(gapOver).length;
    // 한참 못 친 사람이 든 판이면 혼복 비율 때문에 기다리지 않는다(차례가 먼저).
    if (mixTarget != null && !g.some(isOwed)) {
      const isMix = g.some((p) => p.gender === 'M') && g.some((p) => p.gender === 'F');
      const want = mixTarget * (gamesSoFar + 1);
      if (isMix && mixSoFar + 1 > want + 0.5) sev += 1;
      if (!isMix && mixSoFar < want - 1) sev += 1;
    }
    return sev;
  };
  // 여러 판을 한꺼번에 평가할 때(1시간 같이 짜기)는 '지금까지 몇 판' 같은 누적 조절 항을 판마다 넣지 않고
  // 계획 전체에 한 번만 매긴다(아래 planCost). 이 플래그가 켜져 있으면 판 하나의 비용에서 그 항들을 뺀다.
  let planEval = false;
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
        // 차례 지키기: 밀린 사람(지금 후보들 평균보다 0.75판 이상 덜 침)이 든 판은 혼복 비율·급수별 혼복·
        // 게임 종류 같은 '선호' 비용을 약하게 — 선호 때문에 사람이 굶지 않게. 급수·성별 규칙(하드)은 그대로.
        const owed = group.some(isOwed);
        const pref = owed ? 0.25 : 1;
        if (group.length === 4 && !hasRequestPair(group, activeKeys)) {
          if (levelSpread(group, tune.genderOffsetFemale) === 2) c += spread2Over() && !planEval ? SPREAD2_OVER_COST : SPREAD2_COST;
          // 게임 수 맞추기 — 이 판에 들어가면 최소 판수와 N판 넘게 벌어지는 사람마다 큰 비용.
          if (!planEval) for (const p of group) if (gapOver(p)) c += GAP_COST;
          // 급수별 혼복 비율 — 이 사람의 오늘 혼복 비율이 설정보다 많아지거나 모자라면 비용.
          {
            const isMix = group.some((p) => p.gender === 'M') && group.some((p) => p.gender === 'F');
            for (const p of group) {
              const t = levelSetting(p)?.mixedPct;
              if (t == null) continue;
              const want = (t / 100) * (p.mixedGames + p.sameGames + 1);
              if (isMix && p.mixedGames + 1 > want + 0.5) c += 3 * pref;
              if (!isMix && p.mixedGames < want - 0.5) c += 3 * pref;
            }
          }
          const f = group.filter((p) => p.gender === 'F');
          const m = group.filter((p) => p.gender === 'M');
          if (f.length === 2 && m.length === 2) {
            // 혼복 팀 균형: (남+여) vs (남+여) 실제 급수 합 차이가 작은 배치 기준.
            const d1 = Math.abs(m[0].skill + f[0].skill - m[1].skill - f[1].skill);
            const d2 = Math.abs(m[0].skill + f[1].skill - m[1].skill - f[0].skill);
            c += 1.5 * Math.min(d1, d2);
            // 여자 E조 이상은 여복이 기본(서로 랠리가 됨) → 그런 혼복은 비용.
            // F조 여자가 든 혼복은 정배 → 가산점(한 판씩 고르는 엔진이 남복으로 받쳐줄 남자를 먼저 써버리지 않게).
            // (급수별 혼복 비율이 정해진 사람은 위에서 따로 맞추므로 제외)
            const fCount = f.filter((p) => p.skill <= 1 && levelSetting(p)?.mixedPct == null).length;
            if (fCount > 0) c -= 2.5 * fCount * pref;
            else if (gameType === 'same') c += 3 * pref;
            // 남녀 차이는 허용하되 2단계를 넘으면 조금씩(남자가 받쳐주는 구조라도 차이가 작을수록 좋음).
            const gap = (m[0].skill + m[1].skill - f[0].skill - f[1].skill) / 2;
            if (gap > 2) c += 0.8 * (gap - 2);
          }
          // 여자 F조끼리 여복은 랠리가 어려움 → 남자가 받쳐주는 혼복 쪽으로(남자 후보가 있으면).
          if (f.length === 4 && f.some((p) => p.skill <= 1)) c += 3 * pref;
          // 혼복 비율(운영진이 정한 목표) — 오늘 판(시작+대기+이번 호출) 중 혼복이 목표보다 많아지면 혼복에,
          // 모자라면 남복·여복에 비용. 목표에서 1판 벗어날 때마다 MIX_RATIO_COST(공평 약 8게임 상당 — F조 혼복 가산점보다 커야 목표를 지킴).
          if (mixTarget != null && !planEval) {
            const isMix = f.length > 0 && m.length > 0;
            const want = mixTarget * (gamesSoFar + 1);
            if (isMix && mixSoFar + 1 > want + 0.5) c += MIX_RATIO_COST * pref * (mixSoFar + 1 - want);
            if (!isMix && mixSoFar < want - 0.5) c += MIX_RATIO_COST * pref * (want - mixSoFar);
          }
          // 게임 종류 '골고루'·'혼복 위주'·혼복 비율 — 혼복은 2:2로(3:1은 덜), '혼복 위주'면 남복·여복에 비용.
          if (gameType !== 'same') {
            if (f.length === 1 || f.length === 3) c += 2 * pref;
            if (gameType === 'mixed' && (f.length === 0 || m.length === 0)) c += 3 * pref;
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
    if (fewest && fewest.games <= avgGames - 1) parts.push(`${poolNames.get(fewest.id) ?? ''} 오늘 ${Math.round(fewest.games)}판`);
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
    gapAt = at;
    gapMin = gameGap == null ? 0 : robustMin(poolIds.filter((id) => id !== target.outUserId).map((id) => adjGames(toModePlayer(id, at))));
    setFairRef(available);
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

  // ── 1시간 같이 짜기: 필요한 판(count)보다 넉넉히 앞으로 1시간쯤(코트 수 × 2판, 최대 8판 — 48명·6코트에서도 호출당 ~200ms 안)을 먼저 짜고,
  //    판끼리 사람을 바꿔 보며 계획 전체 점수를 낮춘 뒤 앞의 count판만 돌려준다. 한 판씩 고르는 방식은
  //    앞 판이 좋은 사람을 먼저 써버려 뒤 판이 아쉬워지는 문제가 있었다(F조 여자 혼복 가산점도 그 때문).
  const horizon = opts.lookahead === false ? count : Math.max(count, Math.min(8, courts.length * 2));
  const availBase = new Map(availMs);
  const pairWeightBase: Record<string, number> = { ...pairWeight };
  const mix0 = mixSoFar;
  const games0 = gamesSoFar;
  const spread20 = spread2SoFar;
  const slotActives: Set<string>[] = []; // 판마다 그때 유효했던 파트너 요청(계획 다듬기에서 요청을 깨지 않게)
  for (let slot = 0; slot < horizon; slot++) {
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
    // 규칙은 지키지만 아쉬운 판(2단계 차이 · 혼복 비율 목표에서 벗어남)이면 바로 짜지 않고 다음 시점(코트에서
    // 나올 사람까지)도 본다 — 운영진이 '조금 기다리면 맞는 사람이 나온다'며 기다리는 방식. 끝까지 없으면 첫 후보.
    let fallback: { pk: { playerIds: string[] }; m: Map<string, ModePlayer>; at: number; sev: number } | null = null;
    for (const att of attempts) {
      if (att.ids.length < 4) continue;
      const available = att.ids.map((id) => toModePlayer(id, att.at));
      gapAt = att.at;
      gapMin = gameGap == null ? 0 : robustMin(poolIds.map((id) => adjGames(toModePlayer(id, att.at))));
      setFairRef(available);
      const hooks = requestHooks(slotActive, new Set(available.map((p) => p.id)));
      const pk4 = selectFoursomeByMode(available, mode, pairWeight, 4, undefined, tuning, styleScorer, hooks);
      if (pk4.playerIds.length < 4) continue;
      const m = new Map(available.map((p) => [p.id, p]));
      const g = pk4.playerIds.map((id) => m.get(id)!);
      if (ruleBreak(g, slotActive)) continue;
      const sev = softIssue(g, slotActive);
      if (sev > 0) {
        if (!fallback || sev < fallback.sev) fallback = { pk: pk4, m, at: att.at, sev };
        continue;
      }
      picked = pk4;
      byId = m;
      chosenAt = Math.max(att.at, slotStart);
      break;
    }
    if (!picked && fallback) {
      picked = fallback.pk;
      byId = fallback.m;
      chosenAt = Math.max(fallback.at, slotStart);
    }
    if (!picked) {
      if (slot < count)
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
    slotActives.push(slotActive);
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
    const endAt = startAt + predictMs(ordered, startAt);
    courtFree.push(endAt);
    addPairWeight(picked.playerIds, nowMs);
    const mixed = ordered.some((p) => p.gender === 'M') && ordered.some((p) => p.gender === 'F');
    gamesSoFar++;
    if (mixed) mixSoFar++;
    if (levelSpread(ordered, tune.genderOffsetFemale) >= 2) spread2SoFar++;
    for (const id of picked.playerIds) {
      availMs.set(id, endAt);
      extraGames[id] = (extraGames[id] ?? 0) + 1;
      if (mixed) extraMixed[id] = (extraMixed[id] ?? 0) + 1;
      else extraSame[id] = (extraSame[id] ?? 0) + 1;
    }
    slotStart = Math.max(nowMs, Math.min(...courtFree));
  }

  // ── 계획 다듬기(판끼리 한 명씩 맞바꾸기) ──
  if (slotPlayerIds.length >= 2) {
    const K = slotPlayerIds.length;
    const groups = slotPlayerIds.map((ids) => [...ids]);
    const starts = [...slotStarts];
    const mpCache = new Map<string, ModePlayer>();
    const mp = (id: string, i: number) => {
      const k = `${id}@${i}`;
      let v = mpCache.get(k);
      if (!v) { v = toModePlayer(id, starts[i]); mpCache.set(k, v); }
      return v;
    };
    const endOf = (i: number) => starts[i] + predictMs(groups[i].map((id) => mp(id, i)), starts[i]);
    const ends = groups.map((_, i) => endOf(i));
    const hooksAt = slotActives.map((act) => requestHooks(act, new Set(poolIds)));
    // 계획 다듬기에서는 급수 폭을 더 무겁게 — 겹침을 줄이려고 급수를 희생하지 않게(운영진 1순위는 급수).
    // 단 '넉넉하게'(급수 가중 0)면 더하지 않는다(설정과 반대로 다시 좁히지 않게).
    const levelW = (tune.levelWeight ?? 1.5) + (spread2Max >= 0.3 ? 0 : 1.5);
    // 차례 — 지금 기준으로 밀린 정도(후보 평균보다 덜 친 만큼). 밀린 사람이 뒤 판으로 갈수록 비용(판 순서 × 밀린 정도).
    // 사람을 판끼리 바꿔도 각자 판수는 같지만 '언제' 치는지는 바뀌므로, 이 항이 없으면 오래 기다린 사람이 계속
    // 뒤로 밀려 굶을 수 있다(알고리즘 검토 2026-10-27).
    const nowPs = poolIds.map((id) => toModePlayer(id, nowMs));
    const refNow = nowPs.length ? nowPs.reduce((a, p) => a + priorityCost(p, tune.gameCycleSeconds), 0) / nowPs.length : 0;
    const urgency = new Map(nowPs.map((p) => [p.id, Math.max(0, refNow - priorityCost(p, tune.gameCycleSeconds))] as const));
    const waitedLong = new Set(nowPs.filter((p) => p.waitSeconds >= 20 * 60).map((p) => p.id));
    const inRequestPair = (i: number, id: string) => groups[i].some((o) => o !== id && slotActives[i].has(pkey(id, o)));
    const varW = tune.varietyWeight ?? 1;
    // 판 하나의 비용 — 규칙·급수 폭·팀 균형·요청·급수별 혼복·모임 스타일·오늘 이미 같이 친 겹침.
    const groupCost = (i: number) => {
      const g = groups[i].map((id) => mp(id, i));
      const h = hooksAt[i];
      let c = h?.score ? h.score(g) : 0;
      c += levelW * levelSpread(g, tune.genderOffsetFemale);
      for (const id of groups[i]) c += 1.5 * i * (urgency.get(id) ?? 0);
      if (styleScorer) c -= 0.7 * styleScorer(g);
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) c += varW * (pairWeightBase[pkey(groups[i][a], groups[i][b])] ?? 0);
      return c;
    };
    // 계획 전체에 한 번 매기는 항 — 혼복 비율, 2단계 차이 판 비율, 계획 안에서 같은 둘이 또 만나는 것.
    const planGlobal = () => {
      let mixed = 0;
      let s2 = 0;
      const seen = new Map<string, number>();
      for (let i = 0; i < K; i++) {
        const g = groups[i].map((id) => mp(id, i));
        if (g.some((p) => p.gender === 'M') && g.some((p) => p.gender === 'F')) mixed++;
        if (levelSpread(g, tune.genderOffsetFemale) >= 2) s2++;
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
          const k = pkey(groups[i][a], groups[i][b]);
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      }
      let c = 0;
      if (mixTarget != null) c += MIX_RATIO_COST * Math.max(0, Math.abs(mix0 + mixed - mixTarget * (games0 + K)) - 0.5);
      c += SPREAD2_OVER_COST * Math.max(0, spread20 + s2 - spread2Max * (games0 + K) - 0.5);
      for (const v of seen.values()) if (v > 1) c += varW * 1.5 * (v - 1);
      return c;
    };
    // 이 사람이 i번 판에 들어갈 수 있나 — 그 판 시작 전에 비고, 계획 안의 다른 판과 시간이 안 겹침.
    const canJoin = (id: string, i: number, except: number) => {
      if ((availBase.get(id) ?? 0) > starts[i] + SLACK_MS) return false;
      for (let j = 0; j < K; j++) {
        if (j === i || j === except || !groups[j].includes(id)) continue;
        if (!(ends[j] <= starts[i] || ends[i] <= starts[j])) return false;
      }
      return true;
    };
    planEval = true;
    try {
      const costs = groups.map((_, i) => groupCost(i));
      let global = planGlobal();
      for (let iter = 0; iter < 40; iter++) {
        let best: { i: number; j: number; a: number; b: number; delta: number; ci: number; cj: number; g: number } | null = null;
        for (let i = 0; i < K; i++)
          for (let j = i + 1; j < K; j++)
            for (let a = 0; a < 4; a++)
              for (let b = 0; b < 4; b++) {
                const x = groups[i][a];
                const y = groups[j][b];
                if (groups[j].includes(x) || groups[i].includes(y)) continue;
                // 파트너 요청으로 묶인 사람은 그 판에서 빼지 않는다.
                if (inRequestPair(i, x) || inRequestPair(j, y)) continue;
                // 이번에 돌려줄 판(앞 count판)에서 오래 기다린 사람을 뒤 판으로 보내지 않는다.
                if ((i < count && j >= count && waitedLong.has(x)) || (j < count && i >= count && waitedLong.has(y))) continue;
                groups[i][a] = y;
                groups[j][b] = x;
                if (canJoin(y, i, j) && canJoin(x, j, i)) {
                  const gi = groups[i].map((id) => mp(id, i));
                  const gj = groups[j].map((id) => mp(id, j));
                  if (!ruleBreak(gi, slotActives[i]) && !ruleBreak(gj, slotActives[j])) {
                    const ci = groupCost(i);
                    const cj = groupCost(j);
                    const g = planGlobal();
                    const delta = ci + cj + g - costs[i] - costs[j] - global;
                    if (delta < -0.05 && (!best || delta < best.delta)) best = { i, j, a, b, delta, ci, cj, g };
                  }
                }
                groups[i][a] = x;
                groups[j][b] = y;
              }
        if (!best) break;
        const x = groups[best.i][best.a];
        groups[best.i][best.a] = groups[best.j][best.b];
        groups[best.j][best.b] = x;
        costs[best.i] = best.ci;
        costs[best.j] = best.cj;
        global = best.g;
        ends[best.i] = endOf(best.i);
        ends[best.j] = endOf(best.j);
      }
    } finally {
      planEval = false;
    }
    for (let i = 0; i < K; i++) {
      if (groups[i].every((id) => slotPlayerIds[i].includes(id))) continue;
      slotActive = slotActives[i]; // 이유 문구의 '요청: A·B 파트너'도 그 판 기준
      const ordered = splitTeams(groups[i].map((id) => mp(id, i)), tune.genderOffsetFemale, pairWeight, slotActives[i]);
      slotPlayerIds[i] = ordered.map((p) => p.id);
      slotReasons[i] = buildReason(ordered, starts[i]);
    }
  }
  // ── 급수 외톨이 알림 — 오래 기다린 사람 중 오늘 온 사람으로는 규칙(급수·성별) 안 4명을 아예 만들 수 없는
  //    사람(예: C·D조만 온 날의 S조 1명). 엔진이 억지로 짜지 않으니 운영진에게 알려 📌 요청으로 넣게 한다.
  //    + 같이 칠 급수는 있지만 그분들이 다 경기·대기 게임에 잡혀 30분 넘게 0게임인 사람(예: 남S 3명뿐인 날
  //    1명 — 실운영 2026-10-27). 이번에 짠 판에도 없으면 알린다(reason 'busy').
  const stuck: { userId: string; name: string; level: string; waitMin: number; reason: 'level' | 'busy' }[] = [];
  {
    const nowPool = poolIds.filter((id) => !restingIds.has(id)).map((id) => toModePlayer(id, nowMs));
    const longWait = nowPool.filter((p) => p.waitSeconds >= 1.5 * tune.gameCycleSeconds && p.waitSeconds >= 20 * 60);
    const plannedNow = new Set(slotPlayerIds.flat());
    for (const p of longWait) {
      const zeroGames = (playedGames[p.id] ?? 0) + (committedGames[p.id] ?? 0) === 0;
      if (zeroGames && p.waitSeconds >= 30 * 60 && !plannedNow.has(p.id)) {
        stuck.push({
          userId: p.id,
          name: poolNames.get(p.id) ?? '',
          level: `${p.gender === 'F' ? '여' : p.gender === 'M' ? '남' : ''}${NUM_TO_SKILL[Math.min(7, Math.max(1, p.skill))]}`,
          waitMin: Math.round(p.waitSeconds / 60),
          reason: 'busy',
        });
        continue;
      }
      const others = nowPool.filter((q) => q.id !== p.id);
      let possible = false;
      outer: for (let a = 0; a < others.length; a++)
        for (let b = a + 1; b < others.length; b++)
          for (let c = b + 1; c < others.length; c++)
            if (!ruleBreak([p, others[a], others[b], others[c]], slotActive)) { possible = true; break outer; }
      if (!possible)
        stuck.push({
          userId: p.id,
          name: poolNames.get(p.id) ?? '',
          level: `${p.gender === 'F' ? '여' : p.gender === 'M' ? '남' : ''}${NUM_TO_SKILL[Math.min(7, Math.max(1, p.skill))]}`,
          waitMin: Math.round(p.waitSeconds / 60),
          reason: 'level',
        });
    }
  }

  // 앞으로 1시간 계획 중 이번에 필요한 판만 돌려준다(나머지는 다음 호출에서 그때 상황으로 다시 짠다).
  const planned = slotPlayerIds.length;
  slotPlayerIds.splice(count);
  slotReasons.splice(count);
  slotStarts.splice(count);
  // 오늘 현황은 실제로 돌려주는 판까지만.
  if (planned > 0) {
    mixSoFar = mix0;
    gamesSoFar = games0;
    spread2SoFar = spread20;
    for (const ids of slotPlayerIds) {
      const g = ids.map((id) => toModePlayer(id, nowMs));
      gamesSoFar++;
      if (g.some((p) => p.gender === 'M') && g.some((p) => p.gender === 'F')) mixSoFar++;
      if (levelSpread(g, tune.genderOffsetFemale) >= 2) spread2SoFar++;
    }
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
    // 규칙상 같이 칠 4명이 없어 오래 기다리는 사람(운영진 알림 — 📌 요청으로 파트너를 정하면 들어감).
    stuck,
    // 오늘 혼복 비율(이번에 짠 판 포함) — 운영판 '혼복 비율' 옆 실제 값.
    mixToday: { mixed: mixSoFar, total: gamesSoFar },
    spread2Today: spread2SoFar,
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
