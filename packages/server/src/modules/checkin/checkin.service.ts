import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
import { PlayerStatus, SkillLevel, UserRole } from '@badminton/shared';
import type {
  ActiveClubSessionItem,
  AvailablePlayerResponse,
  FacilityCapacityResponse,
  GuestSelfCheckInResponse,
} from '@badminton/shared';
import { getIO } from '../../socket';
import { haversineMeters } from '../../utils/geo';
import { generateTokens } from '../auth/auth.service';
import { logger } from '../../utils/logger';

export interface CheckInParams {
  qrData: string;
  clubSessionId?: string;
  latitude: number;
  longitude: number;
}

export interface GuestCheckInParams {
  qrData: string;
  clubSessionId?: string;
  name: string;
  skillLevel?: SkillLevel;
  gender?: 'M' | 'F' | null;
  latitude: number;
  longitude: number;
}

type ResolvedFacility = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  policy: { checkinRadiusM: number } | null;
};

type ResolvedSession = {
  id: string;
  checkInOpensAt: Date | null;
  checkInClosesAt: Date | null;
};

/**
 * Shared resolution + geofence gate for both member and guest check-in.
 * Resolves the facility by QR, resolves the target ACTIVE ClubSession
 * (explicit id or single-active), enforces the check-in window and the
 * geofence radius. Throws on any failure. Returns the facility and the
 * resolved session id (null = facility-only check-in).
 */
async function resolveSessionAndGeofence(params: {
  qrData: string;
  clubSessionId?: string;
  latitude: number;
  longitude: number;
  /** Audit subject: the member's userId, or 'guest' for guest self check-in. */
  auditUserId: string;
}): Promise<{ facility: ResolvedFacility; resolvedSessionId: string | null }> {
  const { qrData, latitude, longitude, auditUserId } = params;

  // a. Find facility by qrData, include policy
  const facility = await prisma.facility.findUnique({
    where: { qrCodeData: qrData },
    include: { policy: true },
  });
  if (!facility) throw new NotFoundError('시설');

  // b. Resolve target ClubSession
  let resolved: ResolvedSession | null = null;
  if (params.clubSessionId) {
    const session = await prisma.clubSession.findUnique({
      where: { id: params.clubSessionId },
    });
    if (!session) throw new NotFoundError('모임 세션');
    if (session.status !== 'ACTIVE') {
      throw new BadRequestError('진행 중인 정모가 아닙니다');
    }
    if (session.facilityId !== facility.id) {
      throw new BadRequestError('이 정모는 해당 체육관에서 진행되지 않습니다');
    }
    resolved = session;
  } else {
    const activeSessions = await prisma.clubSession.findMany({
      where: { facilityId: facility.id, status: 'ACTIVE' },
    });
    if (activeSessions.length === 1) {
      resolved = activeSessions[0];
    } else if (activeSessions.length > 1) {
      throw new BadRequestError('정모를 선택해주세요');
    }
    // 0 active sessions: facility-only check-in (resolved stays null)
  }

  // c. Check-in window
  if (resolved) {
    const now = new Date();
    if (
      resolved.checkInOpensAt &&
      resolved.checkInClosesAt &&
      (now < resolved.checkInOpensAt || now > resolved.checkInClosesAt)
    ) {
      throw new BadRequestError('체크인 가능 시간이 아닙니다');
    }
  }

  // d. Geofence hard gate
  if (facility.latitude == null || facility.longitude == null) {
    throw new BadRequestError('정모(체육관) 위치가 설정되지 않았습니다');
  }
  const radius = facility.policy?.checkinRadiusM ?? 100;
  const dist = haversineMeters(latitude, longitude, facility.latitude, facility.longitude);
  const distanceM = Math.round(dist);
  const allowed = dist <= radius;

  // Geofence audit trail. The client-supplied lat/lng is trusted (and therefore
  // spoofable), so log EVERY attempt — member and guest, allowed and denied —
  // with structured fields for later review / anomaly detection.
  logger.info('checkin.geofence', {
    event: 'checkin.geofence',
    userId: auditUserId,
    facilityId: facility.id,
    clubSessionId: resolved?.id ?? null,
    distanceM,
    radiusM: radius,
    allowed,
    timestamp: new Date().toISOString(),
  });

  if (!allowed) {
    throw new BadRequestError('정모 위치에서 너무 멀리 떨어져 있습니다', {
      distanceM,
      radiusM: radius,
      facilityName: facility.name,
    });
  }

  return { facility, resolvedSessionId: resolved?.id ?? null };
}

/**
 * Public (UNauthenticated) lookup of the ACTIVE ClubSessions (정모) for a
 * facility QR. Lets a guest/member disambiguate which 정모 they're attending
 * when the facility hosts more than one active 정모. Uses the same facility
 * lookup + ACTIVE ClubSession query as resolveSessionAndGeofence.
 * Throws NotFoundError if the facility isn't found; returns [] if none active.
 */
export async function getActiveSessionsForQr(
  qrData: string,
): Promise<ActiveClubSessionItem[]> {
  const facility = await prisma.facility.findUnique({
    where: { qrCodeData: qrData },
  });
  if (!facility) throw new NotFoundError('시설');

  const activeSessions = await prisma.clubSession.findMany({
    where: { facilityId: facility.id, status: 'ACTIVE' },
    include: { club: true },
    orderBy: { startedAt: 'asc' },
  });

  return activeSessions.map((s) => ({
    clubSessionId: s.id,
    clubName: s.club.name,
    facilityName: facility.name,
    startedAt: s.startedAt.toISOString(),
    scheduledStartAt: s.scheduledStartAt ? s.scheduledStartAt.toISOString() : null,
    title: s.title ?? null,
  }));
}

export async function checkIn(userId: string, params: CheckInParams) {
  const { latitude, longitude } = params;

  const { facility, resolvedSessionId } = await resolveSessionAndGeofence({
    ...params,
    auditUserId: userId,
  });

  // e. Duplicate check: reject any active check-in for this user at this
  // facility, regardless of scope. This prevents a user from ending up with
  // two active check-ins (e.g. one facility-scoped + one session-scoped),
  // which would surface them twice in the available-players pool.
  const existing = await prisma.checkIn.findFirst({
    where: { userId, facilityId: facility.id, checkedOutAt: null },
  });
  if (existing) throw new ConflictError('이미 체크인 상태입니다');

  // f. Create check-in
  const checkIn = await prisma.checkIn.create({
    data: {
      userId,
      facilityId: facility.id,
      clubSessionId: resolvedSessionId,
      checkInLat: latitude,
      checkInLng: longitude,
    },
    include: { facility: true, user: true },
  });

  // g. Sockets: facility + clubSession rooms
  const io = getIO();
  const arrivedPayload = {
    userId,
    userName: checkIn.user.name,
    facilityId: facility.id,
  };
  io.to(`facility:${facility.id}`).emit('checkin:arrived', arrivedPayload);
  if (resolvedSessionId) {
    io.to(`clubSession:${resolvedSessionId}`).emit('checkin:arrived', arrivedPayload);
  }

  await emitPlayersUpdated(facility.id, resolvedSessionId ?? undefined);

  return {
    id: checkIn.id,
    userId: checkIn.userId,
    facilityId: checkIn.facilityId,
    clubSessionId: checkIn.clubSessionId,
    facilityName: checkIn.facility.name,
    checkedInAt: checkIn.checkedInAt.toISOString(),
  };
}

/**
 * Guest self check-in (UNauthenticated web flow). Reuses the same
 * facility/session resolution + geofence gate as member check-in, then
 * creates a lightweight guest User (isGuest, null phone/password), an
 * optional PlayerProfile, and a CheckIn. Returns a JWT access token so the
 * guest's web client can call /checkin/status, join its user socket room,
 * and receive the turn banner.
 */
export async function guestCheckIn(
  params: GuestCheckInParams,
): Promise<GuestSelfCheckInResponse> {
  const { name, skillLevel, gender, latitude, longitude } = params;

  const { facility, resolvedSessionId } = await resolveSessionAndGeofence({
    ...params,
    auditUserId: 'guest',
  });

  // Create guest user (+ optional profile) and check-in.
  // Create a PlayerProfile when a skillLevel and/or gender is provided so the
  // guest surfaces on the board with the same attributes as members.
  const profileData =
    skillLevel || gender
      ? {
          profile: {
            create: {
              ...(skillLevel ? { skillLevel } : {}),
              ...(gender ? { gender } : {}),
            },
          },
        }
      : {};
  const guest = await prisma.user.create({
    data: {
      name,
      isGuest: true,
      role: 'PLAYER',
      ...profileData,
    },
  });

  const checkIn = await prisma.checkIn.create({
    data: {
      userId: guest.id,
      facilityId: facility.id,
      clubSessionId: resolvedSessionId,
      checkInLat: latitude,
      checkInLng: longitude,
      feePaid: false,
    },
    include: { facility: true },
  });

  // Issue a JWT access token for the guest (reuse auth token generation).
  const { accessToken } = generateTokens({ userId: guest.id, role: guest.role });

  // Sockets: same events as a normal check-in so the operator board refreshes.
  const io = getIO();
  const arrivedPayload = {
    userId: guest.id,
    userName: guest.name,
    facilityId: facility.id,
  };
  io.to(`facility:${facility.id}`).emit('checkin:arrived', arrivedPayload);
  if (resolvedSessionId) {
    io.to(`clubSession:${resolvedSessionId}`).emit('checkin:arrived', arrivedPayload);
  }
  await emitPlayersUpdated(facility.id, resolvedSessionId ?? undefined);

  return {
    user: {
      id: guest.id,
      phone: guest.phone,
      name: guest.name,
      role: guest.role as UserRole,
      isGuest: guest.isGuest,
      createdAt: guest.createdAt.toISOString(),
    },
    token: accessToken,
    checkIn: {
      id: checkIn.id,
      userId: checkIn.userId,
      facilityId: checkIn.facilityId,
      clubSessionId: checkIn.clubSessionId,
      facilityName: checkIn.facility.name,
      feeAmount: checkIn.feeAmount,
      feePaid: checkIn.feePaid,
      checkedInAt: checkIn.checkedInAt.toISOString(),
    },
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

  // Defensive cleanup of the user's half-states in the active session so they
  // aren't left in a WAITING turn / auto-assigned after leaving. A PLAYING turn
  // (in-progress game) is left intact — the game finishes naturally.
  const clubSessionId = active.clubSessionId ?? undefined;
  await cleanupTurnsOnCheckout(userId, active.facilityId, clubSessionId);

  const io = getIO();
  const leftPayload = {
    userId,
    facilityId: active.facilityId,
  };
  io.to(`facility:${active.facilityId}`).emit('checkin:left', leftPayload);
  if (active.clubSessionId) {
    io.to(`clubSession:${active.clubSessionId}`).emit('checkin:left', leftPayload);
  }

  await emitPlayersUpdated(active.facilityId, active.clubSessionId ?? undefined);

  return { success: true };
}

/**
 * On checkout, defensively clean a user's half-states for the active session:
 *  - Cancel any WAITING CourtTurn they're a player in (a waiting turn that loses
 *    a player is no longer valid — cancelling is simplest and safest). Remaining
 *    waiting turns on the same court are re-positioned, and the court/turn socket
 *    events are emitted so operator boards refresh.
 *  - Remove them from any QUEUED GameBoardEntry's playerIds for the session's
 *    board so they aren't auto-assigned after leaving.
 *  - PLAYING turns are intentionally left intact (the game finishes naturally);
 *    we only log it.
 */
async function cleanupTurnsOnCheckout(
  userId: string,
  facilityId: string,
  clubSessionId?: string,
) {
  const io = getIO();

  // Resolve the session to clean. The closed check-in may have been a
  // facility-scoped row (clubSessionId null) even though the user is actually
  // participating in an ACTIVE 정모 at this facility (e.g. they hold both a
  // facility-only and a session check-in). Fall back to the facility's single
  // ACTIVE ClubSession so the session board/turns still get cleaned.
  let sessionId = clubSessionId;
  if (!sessionId) {
    const activeSessions = await prisma.clubSession.findMany({
      where: { facilityId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (activeSessions.length === 1) {
      sessionId = activeSessions[0].id;
    }
    // If 0 or >1 active sessions we can't unambiguously pick one; fall back to
    // facility-scoped turn cleanup only (board cleanup is skipped below).
  }

  // Scope turns to the session when known, otherwise to the facility's courts.
  const turnScope = sessionId
    ? { clubSessionId: sessionId }
    : { court: { facilityId } };

  // WAITING turns the user is in → cancel.
  const waitingTurns = await prisma.courtTurn.findMany({
    where: {
      status: 'WAITING',
      players: { some: { userId } },
      ...turnScope,
    },
    select: { id: true, courtId: true },
  });

  const affectedCourtIds = new Set<string>();
  for (const turn of waitingTurns) {
    await prisma.courtTurn.update({
      where: { id: turn.id },
      data: { status: 'CANCELLED' },
    });
    affectedCourtIds.add(turn.courtId);
    io.to(`court:${turn.courtId}`).emit('turn:cancelled', {
      courtId: turn.courtId,
      turnId: turn.id,
    });
  }

  // Re-position the remaining WAITING/PLAYING turns on each affected court.
  for (const courtId of affectedCourtIds) {
    const remaining = await prisma.courtTurn.findMany({
      where: { courtId, status: { in: ['WAITING', 'PLAYING'] } },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].position !== i + 1) {
        await prisma.courtTurn.update({
          where: { id: remaining[i].id },
          data: { position: i + 1 },
        });
      }
    }
  }

  // PLAYING turns the user is in → leave intact, just log.
  if (sessionId) {
    const playing = await prisma.courtTurn.findFirst({
      where: { status: 'PLAYING', players: { some: { userId } }, clubSessionId: sessionId },
      select: { id: true },
    });
    if (playing) {
      logger.info(
        `checkout: user ${userId} left while in PLAYING turn ${playing.id}; game left intact`,
      );
    }
  }

  // Remove the user from any QUEUED GameBoardEntry on the session's board.
  if (sessionId) {
    const board = await prisma.gameBoard.findUnique({
      where: { clubSessionId: sessionId },
      include: { entries: { where: { status: 'QUEUED' } } },
    });
    if (board) {
      let boardChanged = false;
      for (const entry of board.entries) {
        if (!entry.playerIds.includes(userId)) continue;
        const newPlayerIds = entry.playerIds.filter((id) => id !== userId);
        await prisma.gameBoardEntry.update({
          where: { id: entry.id },
          data: { playerIds: newPlayerIds },
        });
        boardChanged = true;
        io.to(`facility:${facilityId}`).emit('gameBoard:entryUpdated', {
          id: entry.id,
          boardId: entry.boardId,
          courtId: entry.courtId || null,
          courtName: '',
          position: entry.position,
          queueOrder: entry.queueOrder ?? 0,
          note: entry.note ?? null,
          playerIds: newPlayerIds,
          playerNames: [],
          status: entry.status,
          turnId: entry.turnId,
          createdAt: entry.createdAt.toISOString(),
        } as any);
      }
      if (boardChanged) {
        logger.info(`checkout: removed user ${userId} from QUEUED board entries`);
      }
    }
  }

  // Refresh the players list / counts for operator boards.
  await emitPlayersUpdated(facilityId, sessionId);
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

export async function getCheckedInUsers(facilityId: string, clubSessionId?: string) {
  const checkins = await prisma.checkIn.findMany({
    where: clubSessionId
      ? { clubSessionId, checkedOutAt: null }
      : { facilityId, checkedOutAt: null },
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

export async function getAvailablePlayers(facilityId: string, clubSessionId?: string): Promise<AvailablePlayerResponse[]> {
  const checkins = await prisma.checkIn.findMany({
    where: clubSessionId
      ? { clubSessionId, checkedOutAt: null }
      : { facilityId, checkedOutAt: null },
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

  // A user can have more than one active check-in (e.g. one facility-scoped
  // with clubSessionId null and one session-scoped). Deduplicate by userId so
  // each player appears at most once. Prefer the check-in matching the
  // requested clubSessionId; otherwise keep the earliest (checkins are already
  // ordered by checkedInAt asc).
  const byUser = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    const existing = byUser.get(c.userId);
    if (!existing) {
      byUser.set(c.userId, c);
      continue;
    }
    // Prefer the one matching the requested session scope.
    if (clubSessionId && c.clubSessionId === clubSessionId && existing.clubSessionId !== clubSessionId) {
      byUser.set(c.userId, c);
    }
    // Otherwise keep `existing` (earliest by checkedInAt).
  }
  const dedupedCheckins = Array.from(byUser.values());

  return dedupedCheckins.map((c) => {
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
      skillLevel: (c.user.profile?.skillLevel || 'D') as SkillLevel,
      preferredGameTypes: (c.user.profile?.preferredGameTypes || ['DOUBLES']) as any[],
      gender: c.user.profile?.gender || null,
      checkedInAt: c.checkedInAt.toISOString(),
      gamesPlayedToday: c.user.gamePlayers.length,
      status,
      isGuest: c.user.isGuest,
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

export async function emitPlayersUpdated(facilityId: string, clubSessionId?: string) {
  const io = getIO();

  // Always emit the facility-scoped counts (preserve existing board behavior).
  const facilityCounts = await computePlayerCounts({ facilityId });
  io.to(`facility:${facilityId}`).emit('players:updated', {
    facilityId,
    ...facilityCounts,
  });

  // Also emit clubSession-scoped counts when a session is in scope.
  if (clubSessionId) {
    const sessionCounts = await computePlayerCounts({ clubSessionId });
    io.to(`clubSession:${clubSessionId}`).emit('players:updated', {
      facilityId,
      clubSessionId,
      ...sessionCounts,
    });
  }
}

async function computePlayerCounts(scope: { facilityId?: string; clubSessionId?: string }) {
  const checkins = await prisma.checkIn.findMany({
    where: scope.clubSessionId
      ? { clubSessionId: scope.clubSessionId, checkedOutAt: null }
      : { facilityId: scope.facilityId, checkedOutAt: null },
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

  return { availableCount, inTurnCount, restingCount };
}

function getStartOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
