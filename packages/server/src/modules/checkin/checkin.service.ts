import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../../utils/errors';
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
  qrData?: string;
  clubSessionId?: string;
  latitude: number;
  longitude: number;
}

export interface GuestCheckInParams {
  qrData?: string;
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
  qrData?: string;
  clubSessionId?: string;
  latitude: number;
  longitude: number;
  /** Audit subject: the member's userId, or 'guest' for guest self check-in. */
  auditUserId: string;
}): Promise<{ facility: ResolvedFacility; resolvedSessionId: string | null }> {
  const { qrData, latitude, longitude, auditUserId } = params;

  let facility: ResolvedFacility;
  let resolved: ResolvedSession | null = null;

  if (params.clubSessionId) {
    // a/b. MEETUP QR path: the scanned per-정모 QR identifies the target 정모
    // directly. Resolve the facility (+ policy) from THAT ClubSession; no
    // facility qrData needed. This path ignores qrData even if present.
    const session = await prisma.clubSession.findUnique({
      where: { id: params.clubSessionId },
      include: { facility: { include: { policy: true } } },
    });
    if (!session) throw new NotFoundError('모임 세션');
    if (session.status !== 'ACTIVE') {
      throw new BadRequestError('진행 중인 정모가 아닙니다');
    }
    facility = session.facility;
    resolved = session;
  } else {
    // a. Facility static-QR path (backward compatible): find facility by qrData.
    if (!qrData) throw new BadRequestError('qrData 또는 clubSessionId가 필요합니다');
    const found = await prisma.facility.findUnique({
      where: { qrCodeData: qrData },
      include: { policy: true },
    });
    if (!found) throw new NotFoundError('시설');
    facility = found;

    // b. Resolve target ClubSession from the facility's ACTIVE sessions.
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
 * UNCONDITIONAL QR check-in into a 정모 (정모 출석 QR flow).
 *
 * The per-정모 출석 QR is shown at the venue, so scanning it IS the presence
 * proof — this path INTENTIONALLY SKIPS the geofence/coords gate that the normal
 * /checkin enforces (no haversine, no lat/lng). It is authenticated: the user
 * must be logged in (the /attend route bounces them through login first).
 *
 * Flow:
 *  - Load the ClubSession (+facility) and assert it is ACTIVE.
 *  - If the user already has an ACTIVE check-in FOR THIS session → return it
 *    (idempotent: scanning again just lands them back on the board, no error).
 *  - Else if they hold an OPEN facility-only check-in here → upgrade it in place
 *    (set its clubSessionId) so they join THIS 정모 without a duplicate row.
 *  - Otherwise create a session-scoped CheckIn (clubSessionId set, facility from
 *    the session) WITHOUT coordinates, then emit the same arrived/players-updated
 *    socket events as a normal check-in so operator boards refresh and the player
 *    appears in the pool.
 */
export async function attendViaQr(clubSessionId: string, userId: string) {
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    include: { facility: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('진행 중인 정모가 아닙니다');
  }

  // BUG-4: Idempotency must key ONLY on an existing OPEN check-in scoped to THIS
  // session. A facility-only (clubSessionId null) open check-in does NOT mean the
  // member is in this 정모's pool — treating it as "already present" left them out
  // of the 정모. So we look up ONLY a session-scoped row here.
  const existing = await prisma.checkIn.findFirst({
    where: { userId, clubSessionId, checkedOutAt: null },
    include: { facility: true },
  });
  if (existing) {
    return {
      success: true as const,
      clubSessionId,
      id: existing.id,
      userId: existing.userId,
      facilityId: existing.facilityId,
      facilityName: existing.facility.name,
      checkedInAt: existing.checkedInAt.toISOString(),
    };
  }

  // BUG-4: if the member holds an OPEN facility-only check-in at this facility,
  // upgrade it in place (set its clubSessionId) so we don't create a duplicate
  // row while still landing them in THIS 정모's pool. Otherwise create a new
  // session-scoped check-in WITHOUT any geofence/coords check (the QR at the
  // venue is the presence proof — see the doc-comment above).
  const facilityOnly = await prisma.checkIn.findFirst({
    where: {
      userId,
      facilityId: session.facilityId,
      clubSessionId: null,
      checkedOutAt: null,
    },
  });
  const checkIn = facilityOnly
    ? await prisma.checkIn.update({
        where: { id: facilityOnly.id },
        data: { clubSessionId: session.id },
        include: { facility: true, user: true },
      })
    : await prisma.checkIn.create({
        data: {
          userId,
          facilityId: session.facilityId,
          clubSessionId: session.id,
        },
        include: { facility: true, user: true },
      });

  // Same socket events as a normal check-in so the operator board + pool refresh.
  const io = getIO();
  const arrivedPayload = {
    userId,
    userName: checkIn.user.name,
    facilityId: session.facilityId,
  };
  io.to(`facility:${session.facilityId}`).emit('checkin:arrived', arrivedPayload);
  io.to(`clubSession:${session.id}`).emit('checkin:arrived', arrivedPayload);
  await emitPlayersUpdated(session.facilityId, session.id);

  return {
    success: true as const,
    clubSessionId,
    id: checkIn.id,
    userId: checkIn.userId,
    facilityId: checkIn.facilityId,
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
  // BUG-3: pick the RIGHT open check-in to close. A stale open row left over from
  // a prior ENDED session must never be chosen over the user's check-in for the
  // currently ACTIVE 정모 (an unordered findFirst could grab the stale one and
  // leave the user in the active pool). Prefer a row whose ClubSession is ACTIVE;
  // otherwise fall back to the most recent open row by checkedInAt.
  const active =
    (await prisma.checkIn.findFirst({
      where: {
        userId,
        checkedOutAt: null,
        clubSession: { status: 'ACTIVE' },
      },
      orderBy: { checkedInAt: 'desc' },
    })) ??
    (await prisma.checkIn.findFirst({
      where: { userId, checkedOutAt: null },
      orderBy: { checkedInAt: 'desc' },
    }));
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
 * Operator checks out a SPECIFIC player from a 정모 (club session).
 *
 * Auth: the operator must be a LEADER or STAFF of the session's club. Finds the
 * target's ACTIVE check-in for that session (preferring the session-scoped row,
 * falling back to a facility-scoped row at the session's facility so a player
 * who checked in facility-only is still removable). Runs the SAME cleanup as a
 * self-checkout — cancel WAITING turns, strip from QUEUED board entries, leave
 * any PLAYING turn intact — and emits the players-updated socket event so every
 * operator board refreshes. Works for guests too (a guest is just a User row).
 *
 * Throws ForbiddenError if the caller isn't a leader/staff, NotFoundError if the
 * session doesn't exist or the target isn't currently checked into it. Returns
 * the refreshed available-players list for the session.
 */
export async function operatorCheckOut(
  clubSessionId: string,
  targetUserId: string,
  operatorUserId: string,
): Promise<{ success: true; availablePlayers: AvailablePlayerResponse[] }> {
  // Resolve the session (+ club) to authorize against and to scope the facility.
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { id: true, clubId: true, facilityId: true },
  });
  if (!session) throw new NotFoundError('모임 세션');

  // Operator must be LEADER/STAFF of the session's club (same check as
  // clubSession.service.verifyClubStaff — replicated to avoid a circular import).
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: operatorUserId, clubId: session.clubId } },
  });
  if (!member || (member.role !== 'LEADER' && member.role !== 'STAFF')) {
    throw new ForbiddenError('모임 리더 또는 스태프만 가능합니다');
  }

  // Find the target's ACTIVE check-in for this 정모. Prefer the session-scoped
  // row; fall back to a facility-scoped row (clubSessionId null) at the session's
  // facility so a facility-only check-in is still removable from the board.
  const active =
    (await prisma.checkIn.findFirst({
      where: { userId: targetUserId, clubSessionId, checkedOutAt: null },
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

  await prisma.checkIn.update({
    where: { id: active.id },
    data: { checkedOutAt: new Date() },
  });

  // SAME cleanup as self-checkout (cancel WAITING turns, strip QUEUED board
  // entries, leave PLAYING intact). Pass the session id explicitly so board
  // cleanup is unambiguous even for a facility-scoped check-in row.
  await cleanupTurnsOnCheckout(targetUserId, session.facilityId, clubSessionId);

  // Mirror the self-checkout socket events so member/guest clients react too.
  const io = getIO();
  const leftPayload = { userId: targetUserId, facilityId: session.facilityId };
  io.to(`facility:${session.facilityId}`).emit('checkin:left', leftPayload);
  io.to(`clubSession:${clubSessionId}`).emit('checkin:left', leftPayload);

  await emitPlayersUpdated(session.facilityId, clubSessionId);

  const availablePlayers = await getAvailablePlayers(session.facilityId, clubSessionId);
  return { success: true, availablePlayers };
}

/**
 * Operator checks a CLUB MEMBER into the active 정모 (출석 체크). Used to take
 * attendance for operator-managed members (and any club member) who don't scan
 * the QR themselves. Creates a session-scoped CheckIn so they enter the 정모 pool
 * and are gameable, mirroring addGuest's check-in + sockets but WITHOUT creating a
 * new user (the member already exists).
 *
 * Auth: the operator must be LEADER/STAFF of the session's club. The target must
 * be a member of that club. Idempotent: if the target already holds an OPEN
 * check-in for this session (or a facility-only one at this facility, which is
 * upgraded in place), no duplicate row is created.
 */
export async function memberCheckIn(
  clubSessionId: string,
  targetUserId: string,
  operatorUserId: string,
): Promise<{ success: true; created: boolean; userId: string; clubSessionId: string }> {
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { id: true, clubId: true, facilityId: true, status: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('진행 중인 정모가 아닙니다');
  }

  // Operator must be LEADER/STAFF of the session's club.
  const operator = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: operatorUserId, clubId: session.clubId } },
  });
  if (!operator || (operator.role !== 'LEADER' && operator.role !== 'STAFF')) {
    throw new ForbiddenError('모임 리더 또는 스태프만 가능합니다');
  }

  // Target must be a member of the session's club.
  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId: session.clubId } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  // Idempotency: already in THIS session's pool → return without creating a row.
  const existing = await prisma.checkIn.findFirst({
    where: { userId: targetUserId, clubSessionId, checkedOutAt: null },
  });
  if (existing) {
    return { success: true, created: false, userId: targetUserId, clubSessionId };
  }

  // Upgrade an open facility-only check-in in place (mirror attendViaQr) rather
  // than creating a duplicate row.
  const facilityOnly = await prisma.checkIn.findFirst({
    where: {
      userId: targetUserId,
      facilityId: session.facilityId,
      clubSessionId: null,
      checkedOutAt: null,
    },
  });
  if (facilityOnly) {
    await prisma.checkIn.update({
      where: { id: facilityOnly.id },
      data: { clubSessionId: session.id },
    });
  } else {
    await prisma.checkIn.create({
      data: {
        userId: targetUserId,
        facilityId: session.facilityId,
        clubSessionId: session.id,
      },
    });
  }

  // Same socket events as a normal check-in so the operator board + pool refresh.
  const io = getIO();
  const arrivedPayload = {
    userId: targetUserId,
    userName: target.user.name,
    facilityId: session.facilityId,
  };
  io.to(`facility:${session.facilityId}`).emit('checkin:arrived', arrivedPayload);
  io.to(`clubSession:${session.id}`).emit('checkin:arrived', arrivedPayload);
  await emitPlayersUpdated(session.facilityId, session.id);

  return { success: true, created: true, userId: targetUserId, clubSessionId };
}

/**
 * Convenience: operator checks in ALL of the club's members not yet checked into
 * the active 정모 (전체 체크인). Reuses memberCheckIn per member so each gets the
 * same idempotent upgrade/create + socket refresh. Returns the count of members
 * NEWLY checked in by this call. Auth is enforced by memberCheckIn.
 */
export async function memberCheckInAll(
  clubSessionId: string,
  operatorUserId: string,
): Promise<{ success: true; checkedInCount: number; clubSessionId: string }> {
  const session = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { id: true, clubId: true, status: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('진행 중인 정모가 아닙니다');
  }

  // memberCheckIn re-verifies operator + session per call; do one upfront check
  // here so 전체 체크인 fails fast (and clearly) for a non-operator.
  const operator = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: operatorUserId, clubId: session.clubId } },
  });
  if (!operator || (operator.role !== 'LEADER' && operator.role !== 'STAFF')) {
    throw new ForbiddenError('모임 리더 또는 스태프만 가능합니다');
  }

  // All members of the club (managed + app members). Guests are not ClubMembers,
  // so they're naturally excluded.
  const members = await prisma.clubMember.findMany({
    where: { clubId: session.clubId },
    select: { userId: true },
  });

  let checkedInCount = 0;
  for (const m of members) {
    const result = await memberCheckIn(clubSessionId, m.userId, operatorUserId);
    if (result.created) checkedInCount += 1;
  }

  return { success: true, checkedInCount, clubSessionId };
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

  // BUG-1: cancelling the CourtTurn alone leaves its linked GameBoardEntry stuck
  // at MATERIALIZED/PLAYING, so the operator board keeps showing that court as
  // 게임중 forever. Transition those entries to CANCELLED too — mirroring
  // turn.service.ts cancelTurn — so the board clears them (no 유령 게임중).
  if (waitingTurns.length > 0) {
    await prisma.gameBoardEntry.updateMany({
      where: {
        turnId: { in: waitingTurns.map((t) => t.id) },
        status: { in: ['MATERIALIZED', 'PLAYING'] },
      },
      data: { status: 'CANCELLED' },
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
            // BUG-2: scope the IN_TURN status check to THIS 정모 when one is in
            // play, otherwise a player PLAYING in another 정모 at the same
            // facility leaks an IN_TURN status into this pool. (Fall back to
            // facility-wide WAITING/PLAYING when no clubSessionId.)
            where: {
              turn: {
                status: { in: ['WAITING', 'PLAYING'] },
                ...(clubSessionId ? { clubSessionId } : {}),
              },
            },
          },
          gamePlayers: {
            where: {
              game: {
                courtId: { not: undefined },
                status: { in: ['IN_PROGRESS', 'COMPLETED'] },
                // A2: per-player game count must be scoped to THIS 정모. When a
                // clubSessionId is supplied, count ONLY games whose turn belongs
                // to this 정모 (otherwise games from OTHER 정모s the same day at
                // the same facility bleed into the count). When facility-scoped
                // (no clubSessionId), fall back to "games today" at this gym.
                ...(clubSessionId
                  ? { turn: { clubSessionId } }
                  : { createdAt: { gte: getStartOfDay() } }),
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

  // C: classify QUEUED (편성됨) players from the 정모 board so the operator pool
  // and member list agree with the board. A player in a court-less QUEUED entry
  // (and not already on a court) is QUEUED, not AVAILABLE.
  const queuedUserIds = await getQueuedBoardUserIds(clubSessionId);

  return dedupedCheckins.map((c) => {
    let status: PlayerStatus;
    if (c.restingAt) {
      status = PlayerStatus.RESTING;
    } else if (c.user.turnPlayers.length > 0) {
      status = PlayerStatus.IN_TURN;
    } else if (queuedUserIds.has(c.userId)) {
      status = PlayerStatus.QUEUED;
    } else {
      status = PlayerStatus.AVAILABLE;
    }

    return {
      userId: c.userId,
      userName: c.user.name,
      skillLevel: (c.user.profile?.skillLevel ?? null) as SkillLevel | null,
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
            // BUG-2: this is the facility-wide capacity view (no clubSessionId in
            // scope), so the IN_TURN check intentionally stays facility-scoped —
            // this is the documented fallback behavior.
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
            // BUG-2: scope IN_TURN to THIS 정모 when one is in play so a player
            // PLAYING in another 정모 at the same facility doesn't leak an
            // IN_TURN count into this session's counts.
            where: {
              turn: {
                status: { in: ['WAITING', 'PLAYING'] },
                ...(scope.clubSessionId ? { clubSessionId: scope.clubSessionId } : {}),
              },
            },
          },
        },
      },
    },
  });

  // C: QUEUED (편성됨) players from the board count separately from AVAILABLE.
  const queuedUserIds = await getQueuedBoardUserIds(scope.clubSessionId);

  let availableCount = 0;
  let inTurnCount = 0;
  let restingCount = 0;
  let queuedCount = 0;

  for (const c of checkins) {
    if (c.restingAt) {
      restingCount++;
    } else if (c.user.turnPlayers.length > 0) {
      inTurnCount++;
    } else if (queuedUserIds.has(c.userId)) {
      queuedCount++;
    } else {
      availableCount++;
    }
  }

  return { availableCount, inTurnCount, restingCount, queuedCount };
}

/**
 * C: userIds placed in a court-less QUEUED GameBoardEntry on the 정모's board
 * (편성됨, not yet on a court). Empty set when no clubSessionId / no board.
 */
async function getQueuedBoardUserIds(clubSessionId?: string): Promise<Set<string>> {
  if (!clubSessionId) return new Set();
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId },
    include: { entries: { where: { status: 'QUEUED' }, select: { playerIds: true, courtId: true } } },
  });
  const ids = new Set<string>();
  for (const e of board?.entries ?? []) {
    if (e.courtId) continue; // on a court → counted as IN_TURN elsewhere
    for (const pid of e.playerIds) ids.add(pid);
  }
  return ids;
}

function getStartOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
