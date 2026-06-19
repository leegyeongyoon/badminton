import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket/index';
import { emitPlayersUpdated } from '../checkin/checkin.service';
import { UserRole, ClubSessionStatus } from '@badminton/shared';
import { sendPushToUser } from '../notification/notification.service';
import { openSession } from '../session/session.service';
import type {
  ClubSessionResponse,
  SkillLevel,
  AddGuestResponse,
  GuestFeeSettlementResponse,
  UpdateFeeInput,
  GuestFeeItem,
  PlayerMatchupsResponse,
  MatchupPartner,
  ClubSessionSummaryResponse,
  SessionSummaryMember,
  SessionSummaryGuest,
  SessionSummaryPerPlayer,
} from '@badminton/shared';

async function verifyClubStaff(clubId: string, userId: string) {
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

export async function startSession(
  clubId: string,
  userId: string,
  input: { facilityId: string; courtIds?: string[] },
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

  // Default to all usable (non-maintenance) facility courts when none specified,
  // so the operator board and viewing board always have courts to work with.
  let courtIds = input.courtIds ?? [];
  if (courtIds.length === 0) {
    const facilityCourts = await prisma.court.findMany({
      where: { facilityId: input.facilityId, status: { not: 'MAINTENANCE' } },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    courtIds = facilityCourts.map((c) => c.id);
  }

  const session = await prisma.clubSession.create({
    data: {
      clubId,
      facilityId: input.facilityId,
      facilitySessionId: facilitySession.id,
      startedById: userId,
      courtIds,
    },
    include: {
      club: true,
      facility: true,
      startedBy: true,
    },
  });

  const mapped = mapClubSession(session);

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

  // Clean up so courts don't drift out of sync (mirrors facility closeSession,
  // but scoped to THIS 정모). Cancel active turns on this session's courts /
  // tagged with this session, EXCEPT ones belonging to ANOTHER still-ACTIVE 정모
  // (don't kill a concurrent club's games). Orphan turns from already-ended
  // sessions get cleaned too (self-heal).
  const activeTurns = await prisma.courtTurn.findMany({
    where: {
      status: { in: ['WAITING', 'PLAYING'] },
      OR: [{ clubSessionId: sessionId }, { courtId: { in: session.courtIds } }],
    },
    select: { id: true, courtId: true, clubSessionId: true },
  });
  const otherSessionIds = [
    ...new Set(activeTurns.map((t) => t.clubSessionId).filter((id): id is string => !!id && id !== sessionId)),
  ];
  const activeOther = otherSessionIds.length
    ? await prisma.clubSession.findMany({
        where: { id: { in: otherSessionIds }, status: 'ACTIVE' },
        select: { id: true },
      })
    : [];
  const activeOtherSet = new Set(activeOther.map((s) => s.id));
  const cancelIds = activeTurns
    .filter((t) => !(t.clubSessionId && activeOtherSet.has(t.clubSessionId)))
    .map((t) => t.id);
  if (cancelIds.length > 0) {
    await prisma.courtTurn.updateMany({
      where: { id: { in: cancelIds } },
      data: { status: 'CANCELLED' },
    });
    await prisma.game.updateMany({
      where: { turnId: { in: cancelIds }, status: 'IN_PROGRESS' },
      data: { status: 'CANCELLED' },
    });
  }

  // Free this session's courts (and any court whose turns we just cancelled)
  // back to EMPTY when no active turn remains — never touch MAINTENANCE.
  const sessionCourtIds = [...new Set([...session.courtIds, ...activeTurns.map((t) => t.courtId)])];
  for (const courtId of sessionCourtIds) {
    const stillActive = await prisma.courtTurn.count({
      where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
    });
    if (stillActive === 0) {
      await prisma.court.updateMany({
        where: { id: courtId, status: { not: 'MAINTENANCE' } },
        data: { status: 'EMPTY' },
      });
    }
  }

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

  const partners: MatchupPartner[] = partnerIds
    .map((id) => {
      const u = userMap.get(id);
      return {
        userId: id,
        name: u?.name ?? '',
        skillLevel: (u?.profile?.skillLevel ?? null) as SkillLevel | null,
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
