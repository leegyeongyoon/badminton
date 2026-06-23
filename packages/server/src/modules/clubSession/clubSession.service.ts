import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket/index';
import { emitPlayersUpdated } from '../checkin/checkin.service';
import { UserRole, ClubSessionStatus } from '@badminton/shared';
import { sendPushToUser } from '../notification/notification.service';
import { openSession } from '../session/session.service';
import QRCode from 'qrcode';
import type {
  ClubSessionResponse,
  SkillLevel,
  AddGuestResponse,
  GuestFeeSettlementResponse,
  UpdateFeeInput,
  EditPlayerInput,
  EditPlayerResponse,
  GuestFeeItem,
  PlayerMatchupsResponse,
  MatchupPartner,
  ClubSessionSummaryResponse,
  SessionSummaryMember,
  SessionSummaryGuest,
  SessionSummaryPerPlayer,
  SessionQrResponse,
  MyStatusResponse,
  ClubSessionListItem,
} from '@badminton/shared';

export async function verifyClubStaff(clubId: string, userId: string) {
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member || (member.role !== 'LEADER' && member.role !== 'STAFF')) {
    throw new ForbiddenError('모임 리더 또는 스태프만 가능합니다');
  }
  return member;
}

// Any member of the club may read derived/summary data for a session of theirs.
async function verifyClubMember(clubId: string, userId: string) {
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member) {
    throw new ForbiddenError('모임 멤버만 조회할 수 있습니다');
  }
  return member;
}

function mapClubSession(session: any): ClubSessionResponse {
  return {
    id: session.id,
    clubId: session.clubId,
    clubName: session.club.name,
    facilityId: session.facilityId,
    facilityName: session.facility.name,
    facilitySessionId: session.facilitySessionId,
    startedById: session.startedById,
    startedByName: session.startedBy.name,
    status: session.status,
    courtIds: session.courtIds,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

/**
 * The courts THIS 정모 owns (Court.clubSessionId = sessionId), as full Court
 * rows ordered by name. Each 정모 owns its OWN courts (코트1·2·3 …) — fully
 * independent of every other 정모; another 정모's identically-named courts are
 * never visible here. Drives the operator board / 코트 관리 modal.
 */
export async function getSessionCourts(sessionId: string) {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  const courts = await prisma.court.findMany({
    where: { clubSessionId: sessionId },
    orderBy: { name: 'asc' },
    include: {
      // The currently-running game on this court, if any. Surfaced so the
      // operator board can render an IN_USE court even when the game was created
      // DIRECTLY (a CourtTurn with no GameBoardEntry — e.g. seeded games or
      // turns started outside the board flow). Without this the board would
      // mistake an occupied court for empty and offer to assign onto it, which
      // the server then rejects ("이미 사용 중인 코트입니다").
      turns: {
        where: { status: { in: ['WAITING', 'PLAYING'] } },
        orderBy: { position: 'asc' },
        include: { players: { include: { user: { select: { id: true, name: true } } } } },
      },
    },
  });

  return courts.map((c) => {
    const playing = c.turns.find((t) => t.status === 'PLAYING') ?? c.turns[0] ?? null;
    const { turns, ...rest } = c;
    return {
      ...rest,
      currentTurn: playing
        ? {
            id: playing.id,
            status: playing.status,
            playerIds: playing.players.map((p) => p.userId),
            playerNames: playing.players.map((p) => p.user.name),
          }
        : null,
    };
  });
}

/** Default number of courts a 정모 registers when none is given. */
const DEFAULT_COURT_COUNT = 4;

export async function startSession(
  clubId: string,
  userId: string,
  input: { facilityId: string; courtCount?: number },
): Promise<ClubSessionResponse> {
  await verifyClubStaff(clubId, userId);

  // Check no active club session for this club (before touching the facility).
  const existing = await prisma.clubSession.findFirst({
    where: { clubId, status: 'ACTIVE' },
  });
  if (existing) {
    throw new BadRequestError('이미 진행 중인 모임 세션이 있습니다');
  }

  // One-click 정모 start: reuse the facility's OPEN session if one exists,
  // otherwise AUTO-CREATE one (openedById = the starting user) so the operator
  // doesn't have to open the gym session as a separate step.
  let facilitySession = await prisma.facilitySession.findFirst({
    where: { facilityId: input.facilityId, status: 'OPEN' },
  });
  if (!facilitySession) {
    const opened = await openSession(input.facilityId, userId);
    facilitySession = await prisma.facilitySession.findUnique({
      where: { id: opened.id },
    });
    if (!facilitySession) {
      throw new BadRequestError('시설 세션을 생성하지 못했습니다');
    }
  }

  // ── Per-정모 OWN courts ──
  // This 정모 owns its OWN courts. No sharing, no locking, no overlap with any
  // other 정모. Create 코트 1 … 코트 N (N = registered count, default 4) belonging
  // ONLY to this session. Another 정모 may have identically-named courts — they
  // never interact (uniqueness is (clubSessionId, name)).
  const courtCount = Math.max(1, input.courtCount ?? DEFAULT_COURT_COUNT);

  const session = await prisma.clubSession.create({
    data: {
      clubId,
      facilityId: input.facilityId,
      facilitySessionId: facilitySession.id,
      startedById: userId,
      courtIds: [],
    },
    include: {
      club: true,
      facility: true,
      startedBy: true,
    },
  });

  // Create this 정모's own courts and keep courtIds in sync (existing readers).
  const courtIds: string[] = [];
  for (let i = 1; i <= courtCount; i++) {
    const court = await prisma.court.create({
      data: { name: `코트 ${i}`, facilityId: input.facilityId, clubSessionId: session.id },
    });
    courtIds.push(court.id);
  }
  const withCourts = await prisma.clubSession.update({
    where: { id: session.id },
    data: { courtIds },
    include: { club: true, facility: true, startedBy: true },
  });

  const mapped = mapClubSession(withCourts);

  const io = getIO();
  io.to(`facility:${input.facilityId}`).emit('clubSession:started', mapped);

  // Notify all club members (except the starter) that the 정모 has started so
  // they can check in. Per-user wrapped so a single push failure never fails
  // the start.
  const members = await prisma.clubMember.findMany({
    where: { clubId },
    select: { userId: true },
  });
  const clubName = session.club.name;
  for (const m of members) {
    if (m.userId === userId) continue;
    try {
      await sendPushToUser(m.userId, {
        title: '정모 시작',
        body: `${clubName} 정모가 시작됐어요 — 체크인하세요`,
        data: { type: 'session_started', clubSessionId: session.id },
      });
    } catch (err) {
      console.warn(`startSession: push failed for member ${m.userId}:`, err);
    }
  }

  return mapped;
}

export async function getSession(sessionId: string): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  return mapClubSession(session);
}

/**
 * Per-정모 출석 QR. Returns a scannable WEB URL payload
 * `<WEB_BASE_URL>/attend?session=<clubSessionId>` plus a PNG data-URL QR
 * encoding that URL (generated via QRCode.toDataURL, same as club invite-qr).
 * Scanning it with a phone camera opens the web app at /attend?session=... which
 * (after login + profile setup if needed) UNCONDITIONALLY checks the user into
 * THIS 정모 (the QR shown at the venue is the presence proof — no geofence) and
 * lands them on the live 현황 보드. Returned for any status (ACTIVE or ENDED);
 * the client decides how to present an ended 정모. Auth: any member of the
 * session's club (verified in the router via the userId passed here).
 */
export async function getSessionQr(
  sessionId: string,
  userId: string,
): Promise<SessionQrResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true },
  });
  if (!session) throw new NotFoundError('모임 세션');

  // Any member of the session's club may view the QR.
  await verifyClubMember(session.clubId, userId);

  // WEB_BASE_URL points at the web app that serves /attend (defaults to local
  // dev), mirroring the club join-QR (<WEB_BASE_URL>/join?code=...).
  const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:8081';
  const payload = `${webBaseUrl}/attend?session=${session.id}`;
  const qr = await QRCode.toDataURL(payload);
  return { clubSessionId: session.id, payload, qr };
}

export async function getActiveSession(clubId: string): Promise<ClubSessionResponse | null> {
  const session = await prisma.clubSession.findFirst({
    where: { clubId, status: 'ACTIVE' },
    include: {
      club: true,
      facility: true,
      startedBy: true,
    },
  });

  if (!session) return null;
  return mapClubSession(session);
}

/**
 * List THIS 모임's 정모들 (one per day), most-recent first, so the club screen can
 * surface the 모임 ↔ 정모 two-level structure (today's 진행 중 정모 + 지난 정모 이력).
 * Each row carries the date/status plus two derived counts:
 *   - attendanceCount: DISTINCT users with a CheckIn for that 정모 (members+guests).
 *   - gameCount: games (IN_PROGRESS|COMPLETED) whose CourtTurn belongs to that 정모.
 * Auth: any member of the club (verified here). Efficient — three queries total
 * (sessions + one CheckIn scan + one Game scan), tallied in memory; no N+1.
 */
export async function listSessions(
  clubId: string,
  requesterId: string,
): Promise<ClubSessionListItem[]> {
  await verifyClubMember(clubId, requesterId);

  const sessions = await prisma.clubSession.findMany({
    where: { clubId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  });
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);

  // Attendance: distinct (clubSessionId, userId) pairs across all these 정모, in
  // one scan. Prisma `distinct` dedupes a user with multiple check-in rows in the
  // same 정모, so each tally is a distinct-user count.
  const checkIns = await prisma.checkIn.findMany({
    where: { clubSessionId: { in: sessionIds } },
    select: { clubSessionId: true, userId: true },
    distinct: ['clubSessionId', 'userId'],
  });
  const attendanceBySession = new Map<string, number>();
  for (const c of checkIns) {
    if (!c.clubSessionId) continue;
    attendanceBySession.set(c.clubSessionId, (attendanceBySession.get(c.clubSessionId) ?? 0) + 1);
  }

  // Games per 정모: every IN_PROGRESS|COMPLETED game whose turn belongs to one of
  // these 정모, tallied by the turn's clubSessionId. One scan, grouped in memory.
  const games = await prisma.game.findMany({
    where: {
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
      turn: { clubSessionId: { in: sessionIds } },
    },
    select: { turn: { select: { clubSessionId: true } } },
  });
  const gamesBySession = new Map<string, number>();
  for (const g of games) {
    const sid = g.turn?.clubSessionId;
    if (!sid) continue;
    gamesBySession.set(sid, (gamesBySession.get(sid) ?? 0) + 1);
  }

  return sessions.map((s) => ({
    id: s.id,
    title: s.title ?? null,
    status: s.status as ClubSessionStatus,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    attendanceCount: attendanceBySession.get(s.id) ?? 0,
    gameCount: gamesBySession.get(s.id) ?? 0,
  }));
}

export async function updateCourts(
  sessionId: string,
  userId: string,
  courtIds: string[],
): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션만 수정할 수 있습니다');
  }

  await verifyClubStaff(session.clubId, userId);

  // courtIds is just this 정모's own set (no cross-session locking / overlap).
  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: { courtIds },
    include: { club: true, facility: true, startedBy: true },
  });

  const mapped = mapClubSession(updated);

  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:courtsUpdated', mapped);

  return mapped;
}

/**
 * 코트 추가 (per-정모): create a NEW court that belongs ONLY to this 정모
 * (clubSessionId = this session) and add it to courtIds. The name is the next
 * "코트 N" among THIS session's own courts (코트1,2,3,… within the 정모) — never a
 * facility-wide scan, so it never collides with or depends on any other 모임.
 */
export async function addSessionCourt(
  sessionId: string,
  userId: string,
): Promise<{ court: { id: string; name: string; status: string }; session: ClubSessionResponse }> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션만 수정할 수 있습니다');
  }
  await verifyClubStaff(session.clubId, userId);

  // THIS 정모's own court names → next free "코트 N" within the 정모.
  const own = await prisma.court.findMany({
    where: { clubSessionId: sessionId },
    select: { name: true },
  });
  const names = new Set(own.map((c) => c.name));
  let maxNum = 0;
  for (const name of names) {
    const m = /^코트\s*(\d+)$/.exec(name.trim());
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  let next = maxNum + 1;
  while (names.has(`코트 ${next}`)) next += 1; // skip any non-"코트 N"-pattern clash
  const courtName = `코트 ${next}`;

  const court = await prisma.court.create({
    data: { name: courtName, facilityId: session.facilityId, clubSessionId: sessionId },
  });

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: { courtIds: { set: [...session.courtIds, court.id] } },
    include: { club: true, facility: true, startedBy: true },
  });

  const mapped = mapClubSession(updated);
  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:courtsUpdated', mapped);

  return {
    court: { id: court.id, name: court.name, status: court.status },
    session: mapped,
  };
}

export async function endSession(
  sessionId: string,
  userId: string,
): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션만 종료할 수 있습니다');
  }

  await verifyClubStaff(session.clubId, userId);

  // Courts belong exclusively to THIS 정모, so cleanup is trivially scoped: cancel
  // this session's own active turns/games and free its courts back to EMPTY. The
  // Court rows are KEPT (their CourtTurns/Games FK to them — history preserved);
  // we only mark the session ended.
  const activeTurns = await prisma.courtTurn.findMany({
    where: {
      clubSessionId: sessionId,
      status: { in: ['WAITING', 'PLAYING'] },
    },
    select: { id: true },
  });
  const cancelIds = activeTurns.map((t) => t.id);
  if (cancelIds.length > 0) {
    // BUG-3: a game that is live when the operator ends the 정모 DID happen, so
    // it must still count in the summary (getSessionSummary counts only
    // IN_PROGRESS|COMPLETED games). Mark such games COMPLETED rather than
    // CANCELLED so they don't vanish from the played count. The turns are still
    // cancelled below so the courts are freed for cleanup.
    await prisma.game.updateMany({
      where: { turnId: { in: cancelIds }, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED' },
    });
    await prisma.courtTurn.updateMany({
      where: { id: { in: cancelIds } },
      data: { status: 'CANCELLED' },
    });
  }

  // Free this 정모's own courts back to EMPTY (never touch MAINTENANCE).
  await prisma.court.updateMany({
    where: { clubSessionId: sessionId, status: { not: 'MAINTENANCE' } },
    data: { status: 'EMPTY' },
  });

  // BUG-3: check out every still-open CheckIn of this 정모. Leaving them with
  // checkedOutAt = NULL creates stale rows that (a) inflate facility check-in
  // counts and (b) can be wrongly closed by a later self-checkout in a DIFFERENT
  // active session. Closing them here keeps the active pool accurate.
  await prisma.checkIn.updateMany({
    where: { clubSessionId: sessionId, checkedOutAt: null },
    data: { checkedOutAt: new Date() },
  });

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date() },
    include: { club: true, facility: true, startedBy: true },
  });

  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:ended', {
    clubSessionId: sessionId,
    clubId: session.clubId,
  });

  return mapClubSession(updated);
}

// --- Hard delete (정모/모임 삭제) ---

/**
 * HARD-delete a 정모 (ClubSession) and ALL of its descendants, bottom-up, inside
 * the given transaction. Distinct from endSession (a graceful end). Works for an
 * IN_PROGRESS (ACTIVE) session too — it just deletes everything.
 *
 * Why a manual bottom-up delete instead of relying on cascades: the schema only
 * cascades PARTIALLY from a ClubSession. ClubSession→Court IS Cascade, but
 * ClubSession→CourtTurn and ClubSession→GameBoard are NOT (default Restrict), and
 * GameBoardEntry's court/turn FKs have no onDelete. So a single
 * prisma.clubSession.delete would fail on the dangling CourtTurn/GameBoard rows.
 * We therefore delete in FK-safe order:
 *   GameBoardEntry → GameBoard → Game → CourtTurn (cascades TurnPlayer) → CheckIn
 *   → Court → ClubSession.
 * (Game/CourtTurn each cascade their own children — GamePlayer/NoShowRecord/
 * TurnPlayer — so those don't need explicit deletes.)
 *
 * Takes a Prisma transaction client so deleteClub can reuse it across many
 * sessions atomically.
 */
async function deleteSessionCascade(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
) {
  // The board(s) for this session, to clear entries first (entries FK board with
  // Cascade, but also FK court/turn WITHOUT cascade — clear them before courts/turns).
  const board = await tx.gameBoard.findUnique({
    where: { clubSessionId: sessionId },
    select: { id: true },
  });
  if (board) {
    await tx.gameBoardEntry.deleteMany({ where: { boardId: board.id } });
    await tx.gameBoard.delete({ where: { id: board.id } });
  }

  // Games then turns of this session. Games FK turn (Cascade) + court (Cascade);
  // delete games first so removing turns/courts can't be blocked.
  const turns = await tx.courtTurn.findMany({
    where: { clubSessionId: sessionId },
    select: { id: true },
  });
  const turnIds = turns.map((t) => t.id);
  if (turnIds.length > 0) {
    await tx.game.deleteMany({ where: { turnId: { in: turnIds } } });
    await tx.courtTurn.deleteMany({ where: { id: { in: turnIds } } });
  }

  // CheckIns of this session (clubSession FK is SetNull, so they wouldn't be
  // removed by the session delete — remove them explicitly so none are orphaned).
  await tx.checkIn.deleteMany({ where: { clubSessionId: sessionId } });

  // This session's own courts (and any games/turns/board-entries still on them).
  // Court→Game/CourtTurn are Cascade; GameBoardEntry.court FK has no cascade but
  // we already cleared all entries above.
  await tx.court.deleteMany({ where: { clubSessionId: sessionId } });

  // Finally the session row itself.
  await tx.clubSession.delete({ where: { id: sessionId } });
}

/**
 * HARD-delete a 정모 (정모 삭제). Auth: SUPER_ADMIN (global role) OR LEADER/STAFF
 * of the session's club. Deletes the session + all descendants (courts, turns,
 * games, board, check-ins) bottom-up in a transaction. Works even if the session
 * is ACTIVE/IN_PROGRESS (this is a hard delete, separate from 정모 종료/endSession).
 */
export async function deleteSession(
  sessionId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ success: true }> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true, facilityId: true },
  });
  if (!session) throw new NotFoundError('모임 세션');

  // SUPER_ADMIN bypasses the per-club staff check; everyone else must be
  // LEADER/STAFF of the session's club.
  if (requesterRole !== 'SUPER_ADMIN') {
    await verifyClubStaff(session.clubId, requesterId);
  }

  await prisma.$transaction(async (tx) => {
    await deleteSessionCascade(tx, sessionId);
  });

  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:ended', {
    clubSessionId: sessionId,
    clubId: session.clubId,
  });

  return { success: true };
}

// Internal: shared session-cascade for club.service.deleteClub (deletes every
// session of a club inside one transaction). Exported so club.service can reuse
// the exact same FK-safe ordering without duplicating it.
export { deleteSessionCascade };

// --- Guests (게스트) ---

/**
 * Operator adds a guest to a club session (LEADER/STAFF of the session's club).
 * Creates a lightweight guest User (isGuest, null phone/password), an optional
 * PlayerProfile, and a CheckIn so the guest is immediately in the pool.
 */
export async function addGuest(
  sessionId: string,
  userId: string,
  input: { name: string; skillLevel?: SkillLevel; gender?: 'M' | 'F' | null; feeAmount?: number },
): Promise<AddGuestResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { facility: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션에만 게스트를 추가할 수 있습니다');
  }
  await verifyClubStaff(session.clubId, userId);

  // Create a PlayerProfile when a skillLevel and/or gender is provided so the
  // guest surfaces on the board with the same attributes as members.
  const profileData =
    input.skillLevel || input.gender
      ? {
          profile: {
            create: {
              ...(input.skillLevel ? { skillLevel: input.skillLevel } : {}),
              ...(input.gender ? { gender: input.gender } : {}),
            },
          },
        }
      : {};
  const guest = await prisma.user.create({
    data: {
      name: input.name,
      isGuest: true,
      role: 'PLAYER',
      ...profileData,
    },
  });

  const checkIn = await prisma.checkIn.create({
    data: {
      userId: guest.id,
      facilityId: session.facilityId,
      clubSessionId: session.id,
      feeAmount: input.feeAmount ?? null,
      feePaid: false,
    },
  });

  // Same socket events as a normal check-in so the operator board refreshes.
  const io = getIO();
  const arrivedPayload = {
    userId: guest.id,
    userName: guest.name,
    facilityId: session.facilityId,
  };
  io.to(`facility:${session.facilityId}`).emit('checkin:arrived', arrivedPayload);
  io.to(`clubSession:${session.id}`).emit('checkin:arrived', arrivedPayload);
  await emitPlayersUpdated(session.facilityId, session.id);

  return {
    guest: {
      id: guest.id,
      phone: guest.phone,
      name: guest.name,
      role: guest.role as UserRole,
      isGuest: guest.isGuest,
      createdAt: guest.createdAt.toISOString(),
    },
    checkIn: {
      id: checkIn.id,
      userId: checkIn.userId,
      facilityId: checkIn.facilityId,
      clubSessionId: checkIn.clubSessionId,
      facilityName: session.facility.name,
      feeAmount: checkIn.feeAmount,
      feePaid: checkIn.feePaid,
      checkedInAt: checkIn.checkedInAt.toISOString(),
    },
  };
}

// Pools for generating random sample guests (Feature 2 — test/demo only).
const RANDOM_GUEST_SURNAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍',
];
const RANDOM_GUEST_GIVEN_NAMES = [
  '민준', '서연', '도윤', '하은', '지호', '서윤', '예준', '지우', '주원', '하윤',
  '시우', '지민', '하준', '수아', '건우', '지유', '우진', '채원', '선우', '다은',
  '현우', '예린', '유준', '소율', '준서', '서아', '연우', '윤서', '정우', '하린',
];
// Realistic skill spread for a club 정모: more B/C/D mid-tier, fewer S/A/F.
const RANDOM_GUEST_SKILL_SPREAD: SkillLevel[] = [
  'S', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C', 'C',
  'D', 'D', 'D', 'E', 'E', 'F',
] as SkillLevel[];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Operator generates N random sample guests for a 정모 and checks them all in
 * (Feature 2 — quick testing/demo). Each is created exactly like an operator-added
 * guest (isGuest, null phone/password, optional PlayerProfile) with a random
 * Korean name, a varied skillLevel (realistic S..F spread), and a random gender,
 * then checked into the session so it lands in the pool and is gameable. EPHEMERAL:
 * like any guest, these vanish on 정모 종료 (their open check-ins are closed).
 *
 * Auth: LEADER/STAFF of the session's club. Reuses addGuest's guest-creation +
 * check-in + socket shape per guest. Returns the count created.
 */
export async function addRandomGuests(
  sessionId: string,
  userId: string,
  count: number,
): Promise<{ createdCount: number; clubSessionId: string }> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { facility: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션에만 게스트를 추가할 수 있습니다');
  }
  await verifyClubStaff(session.clubId, userId);

  const io = getIO();
  let createdCount = 0;
  for (let i = 0; i < count; i++) {
    const name = `${pickRandom(RANDOM_GUEST_SURNAMES)}${pickRandom(RANDOM_GUEST_GIVEN_NAMES)}`;
    const skillLevel = pickRandom(RANDOM_GUEST_SKILL_SPREAD);
    const gender = Math.random() < 0.5 ? 'M' : 'F';

    const guest = await prisma.user.create({
      data: {
        name,
        isGuest: true,
        role: 'PLAYER',
        profile: { create: { skillLevel, gender } },
      },
    });
    await prisma.checkIn.create({
      data: {
        userId: guest.id,
        facilityId: session.facilityId,
        clubSessionId: session.id,
        feePaid: false,
      },
    });
    // Mirror addGuest's arrival event per guest so member/guest clients react.
    io.to(`facility:${session.facilityId}`).emit('checkin:arrived', {
      userId: guest.id,
      userName: guest.name,
      facilityId: session.facilityId,
    });
    createdCount += 1;
  }

  // One players-updated refresh after the batch so operator boards re-render once.
  await emitPlayersUpdated(session.facilityId, session.id);

  return { createdCount, clubSessionId: session.id };
}

/**
 * Guest fee settlement view for a club session (LEADER/STAFF).
 * Returns each guest check-in's fee + paid state, plus totals.
 */
export async function getGuestFees(
  sessionId: string,
  userId: string,
): Promise<GuestFeeSettlementResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new NotFoundError('모임 세션');
  await verifyClubStaff(session.clubId, userId);

  const checkIns = await prisma.checkIn.findMany({
    where: { clubSessionId: sessionId, user: { isGuest: true } },
    include: { user: true },
    orderBy: { checkedInAt: 'asc' },
  });

  const items: GuestFeeItem[] = checkIns.map((c) => ({
    checkInId: c.id,
    userId: c.userId,
    guestName: c.user.name,
    feeAmount: c.feeAmount,
    feePaid: c.feePaid,
  }));

  let totalFee = 0;
  let paidFee = 0;
  for (const c of checkIns) {
    const amount = c.feeAmount ?? 0;
    totalFee += amount;
    if (c.feePaid) paidFee += amount;
  }

  return {
    clubSessionId: sessionId,
    items,
    totals: {
      totalFee,
      paidFee,
      unpaidFee: totalFee - paidFee,
      guestCount: checkIns.length,
    },
  };
}

/**
 * Set/update a (guest) check-in's fee or mark it paid.
 * LEADER/STAFF of the check-in's club session's club.
 */
export async function updateCheckInFee(
  checkInId: string,
  userId: string,
  input: UpdateFeeInput,
): Promise<GuestFeeItem> {
  const checkIn = await prisma.checkIn.findUnique({
    where: { id: checkInId },
    include: { user: true, clubSession: true },
  });
  if (!checkIn) throw new NotFoundError('체크인');
  if (!checkIn.clubSession) {
    throw new BadRequestError('정모에 속하지 않은 체크인입니다');
  }
  await verifyClubStaff(checkIn.clubSession.clubId, userId);

  const updated = await prisma.checkIn.update({
    where: { id: checkInId },
    data: {
      ...(input.feeAmount !== undefined ? { feeAmount: input.feeAmount } : {}),
      ...(input.feePaid !== undefined ? { feePaid: input.feePaid } : {}),
    },
    include: { user: true },
  });

  return {
    checkInId: updated.id,
    userId: updated.userId,
    guestName: updated.user.name,
    feeAmount: updated.feeAmount,
    feePaid: updated.feePaid,
  };
}

/**
 * Operator edits a participant's 이름·급수 from the operate board (a "name-tag"
 * edit — the user does nothing). Updates User.name (global, if given) and the
 * PER-CLUB 급수 (모임별 급수): the operator-set value is written to the target's
 * ClubMember.skillLevel FOR THIS SESSION'S CLUB — it OVERRIDES the user's own
 * default for this club only and is locked from the user's self-edit. null clears
 * the override (미설정 → falls back to the user's own default).
 *
 * EDGE — guests: a session guest is NOT a ClubMember (no row), so there's nothing
 * to override per-club. For a guest we fall back to writing PlayerProfile.skillLevel
 * (their ephemeral own profile) so the edit still reflects on the board.
 *
 * Auth: LEADER/STAFF of the session's club (same guard as the operator checkout).
 * The target MUST be currently checked into THIS 정모 — you can't edit across
 * clubs or edit a non-participant. Emits players-updated so every operator board
 * refreshes with the new name/급수. Returns the updated player (effective 급수).
 */
export async function editPlayer(
  sessionId: string,
  targetUserId: string,
  operatorUserId: string,
  input: EditPlayerInput,
): Promise<EditPlayerResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true, facilityId: true },
  });
  if (!session) throw new NotFoundError('모임 세션');

  // LEADER/STAFF of the session's club only.
  await verifyClubStaff(session.clubId, operatorUserId);

  // The target must be an ACTIVE participant of THIS 정모 (session-scoped, or a
  // facility-scoped open check-in at this session's facility — same resolution
  // as operatorCheckOut). This blocks editing across clubs / non-participants.
  const active =
    (await prisma.checkIn.findFirst({
      where: { userId: targetUserId, clubSessionId: sessionId, checkedOutAt: null },
    })) ??
    (await prisma.checkIn.findFirst({
      where: {
        userId: targetUserId,
        facilityId: session.facilityId,
        clubSessionId: null,
        checkedOutAt: null,
      },
    }));
  if (!active) throw new NotFoundError('체크인된 참가자');

  // Name edit stays on the User (global). Note `skillLevel` may be explicitly
  // null, so distinguish "key present" from undefined.
  if (input.name !== undefined) {
    await prisma.user.update({
      where: { id: targetUserId },
      data: { name: input.name },
    });
  }

  // 급수 edit → PER-CLUB. Write the operator value to the target's ClubMember
  // row for THIS session's club (the per-club override). If the target is NOT a
  // member of this club (a session guest — guests have no ClubMember row), fall
  // back to writing their PlayerProfile.skillLevel (ephemeral own default).
  if (input.skillLevel !== undefined) {
    const membership = await prisma.clubMember.findUnique({
      where: { userId_clubId: { userId: targetUserId, clubId: session.clubId } },
      select: { id: true },
    });
    if (membership) {
      await prisma.clubMember.update({
        where: { id: membership.id },
        data: { skillLevel: input.skillLevel },
      });
    } else {
      // Guest fallback: write their own ephemeral PlayerProfile.
      await prisma.user.update({
        where: { id: targetUserId },
        data: {
          profile: {
            upsert: {
              create: { skillLevel: input.skillLevel },
              update: { skillLevel: input.skillLevel },
            },
          },
        },
      });
    }
  }

  // Re-read the target with name + effective per-club 급수 for the response.
  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      isGuest: true,
      profile: { select: { skillLevel: true } },
      clubMembers: {
        where: { clubId: session.clubId },
        select: { skillLevel: true },
        take: 1,
      },
    },
  });

  // Refresh every operator board (same event the checkout / addGuest emit).
  await emitPlayersUpdated(session.facilityId, sessionId);

  const effectiveSkill =
    (updated.clubMembers[0]?.skillLevel ?? updated.profile?.skillLevel ?? null) as SkillLevel | null;

  return {
    userId: updated.id,
    name: updated.name,
    skillLevel: effectiveSkill,
    isGuest: updated.isGuest,
  };
}

// --- B1: Player matchups within a 정모 (선수 매치업) ---

/**
 * For a given user IN THIS 정모, return how many games they played and, for
 * everyone they shared a game with, the partner's profile + shared-game count.
 * Derived (no scoring): Games whose CourtTurn belongs to this clubSession and
 * have a GamePlayer for the target user; collect the OTHER GamePlayers and
 * count frequencies. Auth: any member of the session's club.
 */
export async function getPlayerMatchups(
  sessionId: string,
  targetUserId: string,
  requesterId: string,
): Promise<PlayerMatchupsResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new NotFoundError('모임 세션');
  await verifyClubMember(session.clubId, requesterId);

  // All games this 정모 (turn.clubSessionId = sessionId), with their players.
  const games = await prisma.game.findMany({
    where: {
      turn: { clubSessionId: sessionId },
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
    },
    select: { id: true, players: { select: { userId: true } } },
  });

  let totalGames = 0;
  const partnerCounts = new Map<string, number>();
  for (const game of games) {
    const ids = game.players.map((p) => p.userId);
    if (!ids.includes(targetUserId)) continue;
    totalGames++;
    for (const id of ids) {
      if (id === targetUserId) continue;
      partnerCounts.set(id, (partnerCounts.get(id) ?? 0) + 1);
    }
  }

  // Resolve partner profiles.
  const partnerIds = Array.from(partnerCounts.keys());
  const users = partnerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: partnerIds } },
        select: { id: true, name: true, profile: { select: { skillLevel: true, gender: true } } },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  // PER-CLUB 급수 (모임별 급수): show the EFFECTIVE per-club skill in the matchup
  // modal — ClubMember(userId, session.clubId).skillLevel overrides the user's own
  // default. Guests (no ClubMember row) fall back to their own profile default.
  const skillOverrides = partnerIds.length
    ? await prisma.clubMember.findMany({
        where: { clubId: session.clubId, userId: { in: partnerIds } },
        select: { userId: true, skillLevel: true },
      })
    : [];
  const skillOverrideMap = new Map(skillOverrides.map((m) => [m.userId, m.skillLevel]));

  const partners: MatchupPartner[] = partnerIds
    .map((id) => {
      const u = userMap.get(id);
      return {
        userId: id,
        name: u?.name ?? '',
        skillLevel: (skillOverrideMap.get(id) ?? u?.profile?.skillLevel ?? null) as SkillLevel | null,
        gender: u?.profile?.gender ?? null,
        count: partnerCounts.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { userId: targetUserId, totalGames, partners };
}

// --- B2: 정모 종료 요약 리포트 (Club session summary) ---

/**
 * Summary report for a 정모. Works whether the session is ACTIVE or ENDED.
 * Auth: any member of the session's club (read-only derived data).
 * - attendance: from CheckIn rows for this clubSessionId (members vs guests),
 *   each with their games-played count for the session.
 * - games/perPlayer: from Games whose CourtTurn belongs to this clubSession.
 * - guestFees: reuses getGuestFees' totals (totalFee/paidFee/unpaidFee/guestCount).
 */
export async function getSessionSummary(
  sessionId: string,
  requesterId: string,
): Promise<ClubSessionSummaryResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new NotFoundError('모임 세션');
  await verifyClubMember(session.clubId, requesterId);

  // Attendance: all check-ins for this session (members + guests). A user may
  // theoretically have more than one check-in row; dedupe by userId.
  const checkIns = await prisma.checkIn.findMany({
    where: { clubSessionId: sessionId },
    include: { user: { select: { id: true, name: true, isGuest: true } } },
    orderBy: { checkedInAt: 'asc' },
  });

  // Games this 정모 → per-player counts.
  const games = await prisma.game.findMany({
    where: {
      turn: { clubSessionId: sessionId },
      status: { in: ['IN_PROGRESS', 'COMPLETED'] },
    },
    select: { players: { select: { userId: true } } },
  });
  const gamesByUser = new Map<string, number>();
  for (const game of games) {
    for (const p of game.players) {
      gamesByUser.set(p.userId, (gamesByUser.get(p.userId) ?? 0) + 1);
    }
  }

  const members: SessionSummaryMember[] = [];
  const guests: SessionSummaryGuest[] = [];
  const seen = new Set<string>();
  for (const c of checkIns) {
    if (seen.has(c.userId)) continue;
    seen.add(c.userId);
    const gamesPlayed = gamesByUser.get(c.userId) ?? 0;
    if (c.user.isGuest) {
      guests.push({
        userId: c.userId,
        name: c.user.name,
        gamesPlayed,
        feeAmount: c.feeAmount,
        feePaid: c.feePaid,
      });
    } else {
      members.push({ userId: c.userId, name: c.user.name, gamesPlayed });
    }
  }

  // perPlayer: everyone who played a game this 정모, sorted by count desc.
  const playerIds = Array.from(gamesByUser.keys());
  const users = playerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: playerIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const perPlayer: SessionSummaryPerPlayer[] = playerIds
    .map((id) => ({ userId: id, name: nameMap.get(id) ?? '', count: gamesByUser.get(id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Guest fee totals (reuse the same aggregation getGuestFees uses).
  const guestCheckIns = checkIns.filter((c) => c.user.isGuest);
  let totalFee = 0;
  let paidFee = 0;
  for (const c of guestCheckIns) {
    const amount = c.feeAmount ?? 0;
    totalFee += amount;
    if (c.feePaid) paidFee += amount;
  }

  return {
    session: {
      title: session.title ?? null,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      status: session.status as ClubSessionStatus,
    },
    attendance: {
      memberCount: members.length,
      guestCount: guests.length,
      total: members.length + guests.length,
      members,
      guests,
    },
    games: {
      total: games.length,
      perPlayer,
    },
    guestFees: {
      totalFee,
      paidFee,
      unpaidFee: totalFee - paidFee,
      guestCount: guestCheckIns.length,
    },
  };
}

// --- C: Board-aware player status (내 현황) ---

/**
 * Board-aware "my upcoming game" for a user. Unlike getMyTurns (which only
 * reads CourtTurn/TurnPlayer), this ALSO reads the active 정모's GameBoard so a
 * court-less QUEUED entry surfaces as a real "다음 게임 · 대기 N번째" state
 * instead of falling through to a flat "대기 중".
 *
 * Resolution: find the user's ACTIVE check-in → its 정모 (or the facility's
 * single ACTIVE 정모) → that 정모's board. Then classify:
 *   - PLAYING  : a PLAYING CourtTurn in this 정모 (코트 X · 게임 중)
 *   - QUEUED   : a QUEUED GameBoardEntry containing the user. queueOrder = its
 *                1-based position among QUEUED entries; courtName null (코트 미정);
 *                etaGames = games queued ahead of it.
 *   - AVAILABLE: checked in, nothing staged.
 *   - null     : not checked into any active 정모.
 */
export async function getMyStatus(userId: string): Promise<MyStatusResponse | null> {
  const active = await prisma.checkIn.findFirst({
    where: { userId, checkedOutAt: null },
    orderBy: { checkedInAt: 'desc' },
    select: { clubSessionId: true, facilityId: true },
  });
  if (!active) return null;

  // Candidate 정모(s) to read. A session-scoped check-in pins one 정모; a
  // facility-only check-in (web/QR) can map to several ACTIVE 정모 at the
  // facility, so we keep ALL of them and let the board/turn lookup below pick
  // the one the user is actually composed into. This is what makes the status
  // board-aware even when the facility runs multiple concurrent 정모.
  let candidateSessionIds: string[];
  if (active.clubSessionId) {
    candidateSessionIds = [active.clubSessionId];
  } else {
    const activeSessions = await prisma.clubSession.findMany({
      where: { facilityId: active.facilityId, status: 'ACTIVE' },
      select: { id: true },
    });
    candidateSessionIds = activeSessions.map((s) => s.id);
  }
  if (candidateSessionIds.length === 0) return null;

  // PLAYING turn in any candidate 정모 takes precedence (게임 중).
  const playing = await prisma.courtTurn.findFirst({
    where: {
      clubSessionId: { in: candidateSessionIds },
      status: 'PLAYING',
      players: { some: { userId } },
    },
    include: { court: { select: { name: true } } },
  });
  if (playing) {
    return {
      status: 'PLAYING',
      clubSessionId: playing.clubSessionId!,
      queueOrder: null,
      courtName: playing.court?.name ?? null,
      etaGames: null,
      turnId: playing.id,
    };
  }

  // A WAITING turn (already materialized onto a court) → next up on that court.
  const waiting = await prisma.courtTurn.findFirst({
    where: {
      clubSessionId: { in: candidateSessionIds },
      status: 'WAITING',
      players: { some: { userId } },
    },
    include: { court: { select: { name: true } } },
    orderBy: { position: 'asc' },
  });
  if (waiting) {
    return {
      status: 'QUEUED',
      clubSessionId: waiting.clubSessionId!,
      queueOrder: waiting.position,
      courtName: waiting.court?.name ?? null,
      etaGames: Math.max(0, waiting.position - 1),
      turnId: waiting.id,
    };
  }

  // A court-less QUEUED board entry → "다음 게임 · 대기 N번째 · 코트 미정".
  const boards = await prisma.gameBoard.findMany({
    where: { clubSessionId: { in: candidateSessionIds } },
    include: { entries: { where: { status: 'QUEUED' }, orderBy: { queueOrder: 'asc' } } },
  });
  for (const board of boards) {
    const queued = board.entries.filter((e) => !e.courtId);
    const idx = queued.findIndex((e) => (e.playerIds as string[]).includes(userId));
    if (idx >= 0) {
      return {
        status: 'QUEUED',
        clubSessionId: board.clubSessionId,
        queueOrder: idx + 1,
        courtName: null,
        etaGames: idx,
        turnId: null,
      };
    }
  }

  // Checked in but not composed into any candidate 정모's game. With a single
  // candidate we can name the 정모; with several ambiguous ones, fall back to
  // the most recently started so the board button still resolves.
  let availableSessionId = candidateSessionIds[0];
  if (candidateSessionIds.length > 1) {
    const latest = await prisma.clubSession.findFirst({
      where: { id: { in: candidateSessionIds } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (latest) availableSessionId = latest.id;
  }
  return {
    status: 'AVAILABLE',
    clubSessionId: availableSessionId,
    queueOrder: null,
    courtName: null,
    etaGames: null,
    turnId: null,
  };
}
