import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../../utils/prisma';
import { NotFoundError, ConflictError, ForbiddenError } from '../../utils/errors';
import type {
  CreateClubInput,
  ClubMemberResponse,
  AttendancePeriod,
  AttendanceLeaderboardEntry,
  AttendanceLeaderboardResponse,
  ManagedMemberInput,
  BulkAddManagedMembersResponse,
  ManagedMemberResponse,
} from '@badminton/shared';
import type { ClubMemberRole, SkillLevel } from '@badminton/shared';
import { PlayerStatus } from '@badminton/shared';

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export async function createClub(userId: string, input: CreateClubInput) {
  const club = await prisma.club.create({
    data: {
      name: input.name,
      inviteCode: generateInviteCode(),
      members: { create: { userId, role: 'LEADER' } },
    },
    include: { _count: { select: { members: true } } },
  });

  return {
    id: club.id,
    name: club.name,
    inviteCode: club.inviteCode,
    homeFacilityId: club.homeFacilityId,
    memberCount: club._count.members,
    createdAt: club.createdAt.toISOString(),
  };
}

export async function listMyClubs(userId: string) {
  const memberships = await prisma.clubMember.findMany({
    where: { userId },
    include: {
      club: { include: { _count: { select: { members: true } } } },
    },
  });

  return memberships.map((m) => ({
    id: m.club.id,
    name: m.club.name,
    inviteCode: m.club.inviteCode,
    homeFacilityId: m.club.homeFacilityId,
    memberCount: m.club._count.members,
    role: m.role,
    createdAt: m.club.createdAt.toISOString(),
  }));
}

export async function joinClub(userId: string, inviteCode: string) {
  const club = await prisma.club.findUnique({ where: { inviteCode } });
  if (!club) throw new NotFoundError('모임');

  const existing = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: club.id } },
  });
  if (existing) throw new ConflictError('이미 가입된 모임입니다');

  await prisma.clubMember.create({
    data: { userId, clubId: club.id },
  });

  return { success: true, clubId: club.id, clubName: club.name };
}

/**
 * Club join QR (모임 참여 QR).
 *
 * Returns the club's inviteCode, a web join URL, and a PNG data-URL QR encoding
 * that URL. Scanning the QR with a phone camera opens the web app at
 * `<WEB_BASE_URL>/join?code=<inviteCode>`, which (after login + profile setup if
 * needed) auto-joins the scanner into the club.
 *
 * Auth: ANY member of the club may view/share it (a member inviting friends is
 * the normal case). Non-members are rejected.
 */
export async function getInviteQr(clubId: string, userId: string) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new NotFoundError('모임');

  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member) throw new ForbiddenError('모임 멤버만 조회할 수 있습니다');

  // WEB_BASE_URL points at the web app that serves /join (defaults to local dev).
  const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:8081';
  const joinUrl = `${webBaseUrl}/join?code=${club.inviteCode}`;
  const qr = await QRCode.toDataURL(joinUrl);

  return { inviteCode: club.inviteCode, joinUrl, qr };
}

/**
 * C: userIds placed in a court-less QUEUED GameBoardEntry on this club's ACTIVE
 * 정모 board (편성됨). Empty set when there's no active session / board.
 */
async function getActiveSessionQueuedUserIds(clubId: string): Promise<Set<string>> {
  const session = await prisma.clubSession.findFirst({
    where: { clubId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!session) return new Set();
  const board = await prisma.gameBoard.findUnique({
    where: { clubSessionId: session.id },
    include: { entries: { where: { status: 'QUEUED' }, select: { playerIds: true, courtId: true } } },
  });
  const ids = new Set<string>();
  for (const e of board?.entries ?? []) {
    if (e.courtId) continue;
    for (const pid of e.playerIds) ids.add(pid);
  }
  return ids;
}

export async function getMembers(clubId: string, facilityId?: string): Promise<ClubMemberResponse[]> {
  const facilityFilter = facilityId
    ? { checkedOutAt: null, facilityId }
    : { checkedOutAt: null };

  const members = await prisma.clubMember.findMany({
    where: { clubId },
    include: {
      user: {
        include: {
          profile: true,
          checkIns: {
            where: facilityFilter,
            take: 1,
          },
          turnPlayers: {
            where: {
              turn: { status: { in: ['WAITING', 'PLAYING'] } },
            },
            take: 1,
          },
        },
      },
    },
  });

  // C: classify QUEUED (편성됨) members from THIS club's ACTIVE 정모 board so the
  // member list agrees with the operator board. Court-less QUEUED entry → QUEUED.
  const queuedUserIds = await getActiveSessionQueuedUserIds(clubId);

  return members.map((m) => {
    const isCheckedIn = m.user.checkIns.length > 0;
    const isInTurn = m.user.turnPlayers.length > 0;
    let playerStatus: PlayerStatus | null = null;
    if (isCheckedIn) {
      const checkIn = m.user.checkIns[0];
      if (isInTurn) {
        playerStatus = PlayerStatus.IN_TURN;
      } else if (checkIn.restingAt) {
        playerStatus = PlayerStatus.RESTING;
      } else if (queuedUserIds.has(m.user.id)) {
        playerStatus = PlayerStatus.QUEUED;
      } else {
        playerStatus = PlayerStatus.AVAILABLE;
      }
    }

    return {
      userId: m.user.id,
      name: m.user.name,
      role: m.role as ClubMemberRole,
      skillLevel: (m.user.profile?.skillLevel ?? null) as SkillLevel | null,
      gender: m.user.profile?.gender ?? null,
      isCheckedIn,
      facilityId: m.user.checkIns[0]?.facilityId ?? null,
      playerStatus,
    };
  });
}

export async function updateMemberRole(
  clubId: string,
  targetUserId: string,
  role: ClubMemberRole,
  requesterId: string,
) {
  // Verify requester is LEADER
  const requester = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: requesterId, clubId } },
  });
  if (!requester || requester.role !== 'LEADER') {
    throw new ForbiddenError('리더만 역할을 변경할 수 있습니다');
  }

  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  await prisma.clubMember.update({
    where: { userId_clubId: { userId: targetUserId, clubId } },
    data: { role },
  });

  return { success: true };
}

// Leader/Staff assigns a member's 급수 (skill level) / gender (Korean clubs let staff set 급수).
export async function updateMemberProfile(
  clubId: string,
  targetUserId: string,
  data: { skillLevel?: SkillLevel; gender?: string | null },
  requesterId: string,
): Promise<ClubMemberResponse> {
  // Verify requester is LEADER or STAFF of this club.
  const requester = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: requesterId, clubId } },
  });
  if (!requester || (requester.role !== 'LEADER' && requester.role !== 'STAFF')) {
    throw new ForbiddenError('운영진만 급수를 변경할 수 있습니다');
  }

  // Verify the target is a member of this club.
  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
    include: {
      user: {
        include: {
          checkIns: { where: { checkedOutAt: null }, take: 1 },
          turnPlayers: {
            where: { turn: { status: { in: ['WAITING', 'PLAYING'] } } },
            take: 1,
          },
        },
      },
    },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  const profile = await prisma.playerProfile.upsert({
    where: { userId: targetUserId },
    create: {
      userId: targetUserId,
      ...(data.skillLevel !== undefined && { skillLevel: data.skillLevel as any }),
      ...(data.gender !== undefined && { gender: data.gender }),
    },
    update: {
      ...(data.skillLevel !== undefined && { skillLevel: data.skillLevel as any }),
      ...(data.gender !== undefined && { gender: data.gender }),
    },
  });

  const isCheckedIn = target.user.checkIns.length > 0;
  const isInTurn = target.user.turnPlayers.length > 0;
  let playerStatus: PlayerStatus | null = null;
  if (isCheckedIn) {
    const checkIn = target.user.checkIns[0];
    if (isInTurn) {
      playerStatus = PlayerStatus.IN_TURN;
    } else if (checkIn.restingAt) {
      playerStatus = PlayerStatus.RESTING;
    } else {
      playerStatus = PlayerStatus.AVAILABLE;
    }
  }

  return {
    userId: target.user.id,
    name: target.user.name,
    role: target.role as ClubMemberRole,
    skillLevel: (profile.skillLevel ?? null) as SkillLevel | null,
    gender: profile.gender ?? null,
    isCheckedIn,
    facilityId: target.user.checkIns[0]?.facilityId ?? null,
    playerStatus,
  };
}

// --- Managed members (운영자 관리 멤버) ---

/**
 * Bulk-register PERSISTENT operator-managed members for a club (LEADER/STAFF).
 *
 * A managed member is a real, persistent club member who has NO app login:
 *  - a User row with isManaged=true (no usable password; phone left null so the
 *    unique phone constraint never collides — managed members never sign in),
 *  - an optional PlayerProfile (skillLevel / gender) so they surface on the board
 *    with the same attributes as app members,
 *  - a ClubMember row (role MEMBER) so they PERSIST in the roster across 정모s.
 *
 * Idempotent-ish: a name that already belongs to a managed member of THIS club is
 * skipped (returned in `skipped`) rather than duplicated. Returns the created
 * members + the skipped names.
 */
export async function bulkAddManagedMembers(
  clubId: string,
  requesterId: string,
  members: ManagedMemberInput[],
): Promise<BulkAddManagedMembersResponse> {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new NotFoundError('모임');

  // LEADER/STAFF of this club only.
  const requester = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: requesterId, clubId } },
  });
  if (!requester || (requester.role !== 'LEADER' && requester.role !== 'STAFF')) {
    throw new ForbiddenError('운영진만 멤버를 추가할 수 있습니다');
  }

  // Existing managed-member names in this club, to skip exact duplicates.
  const existing = await prisma.clubMember.findMany({
    where: { clubId, user: { isManaged: true } },
    select: { user: { select: { name: true } } },
  });
  const existingNames = new Set(existing.map((m) => m.user.name));

  const created: ManagedMemberResponse[] = [];
  const skipped: string[] = [];
  // Track names handled within THIS request too (dedupe duplicates in the payload).
  const seenInBatch = new Set<string>();

  for (const m of members) {
    const name = m.name.trim();
    if (!name) continue;
    if (existingNames.has(name) || seenInBatch.has(name)) {
      skipped.push(name);
      continue;
    }
    seenInBatch.add(name);

    const profileData =
      m.skillLevel || m.gender
        ? {
            profile: {
              create: {
                ...(m.skillLevel ? { skillLevel: m.skillLevel as any } : {}),
                ...(m.gender ? { gender: m.gender } : {}),
              },
            },
          }
        : {};

    // User (isManaged, no login) + ClubMember (role MEMBER) created together so a
    // managed member always lands in the roster atomically.
    const user = await prisma.user.create({
      data: {
        name,
        isManaged: true,
        role: 'PLAYER',
        ...profileData,
        clubMembers: { create: { clubId, role: 'MEMBER' } },
      },
      include: { profile: true },
    });

    created.push({
      userId: user.id,
      name: user.name,
      role: 'MEMBER' as ClubMemberRole,
      skillLevel: (user.profile?.skillLevel ?? null) as SkillLevel | null,
      gender: user.profile?.gender ?? null,
    });
  }

  return { created, skipped };
}

// --- Attendance leaderboard (출석왕) ---

async function verifyClubMember(clubId: string, userId: string) {
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member) throw new ForbiddenError('모임 멤버만 조회할 수 있습니다');
  return member;
}

// Returns the inclusive start Date for a period, or null for 'all'.
function periodStart(period: AttendancePeriod): Date | null {
  const now = new Date();
  if (period === 'month') {
    // current calendar month: 1st of this month → now
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
  if (period === 'year') {
    // current calendar year: Jan 1 of this year → now
    return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  return null; // 'all'
}

const LEADERBOARD_LIMIT = 50;

export async function getAttendanceLeaderboard(
  clubId: string,
  period: AttendancePeriod,
  userId: string,
): Promise<AttendanceLeaderboardResponse> {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new NotFoundError('모임');
  await verifyClubMember(clubId, userId);

  const start = periodStart(period);

  // Only members of this club, excluding guests.
  const members = await prisma.clubMember.findMany({
    where: { clubId, user: { isGuest: false } },
    include: { user: { include: { profile: true } } },
  });
  const memberIds = members.map((m) => m.userId);

  // Distinct ClubSessions of this club each member checked into within the period.
  // CheckIn.clubSessionId -> ClubSession.clubId = clubId; filter by CheckIn.checkedInAt.
  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: { in: memberIds },
      clubSessionId: { not: null },
      clubSession: { clubId },
      ...(start ? { checkedInAt: { gte: start } } : {}),
    },
    select: { userId: true, clubSessionId: true },
  });

  // Count DISTINCT clubSessionId per user.
  const distinctSessions = new Map<string, Set<string>>();
  for (const c of checkIns) {
    if (!c.clubSessionId) continue;
    let set = distinctSessions.get(c.userId);
    if (!set) {
      set = new Set<string>();
      distinctSessions.set(c.userId, set);
    }
    set.add(c.clubSessionId);
  }

  // Build per-member rows (members with 0 attendance still appear with count 0).
  const rows = members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    skillLevel: (m.user.profile?.skillLevel ?? null) as SkillLevel | null,
    attendanceCount: distinctSessions.get(m.userId)?.size ?? 0,
  }));

  // Sort desc by attendanceCount, then by name for stable ordering.
  rows.sort((a, b) =>
    b.attendanceCount - a.attendanceCount || a.name.localeCompare(b.name),
  );

  // Assign dense ranks (ties share a rank).
  const ranked: AttendanceLeaderboardEntry[] = [];
  let lastCount: number | null = null;
  let lastRank = 0;
  rows.forEach((row, idx) => {
    let rank: number;
    if (lastCount !== null && row.attendanceCount === lastCount) {
      rank = lastRank;
    } else {
      rank = idx + 1;
      lastRank = rank;
      lastCount = row.attendanceCount;
    }
    ranked.push({ ...row, rank });
  });

  const me = ranked.find((r) => r.userId === userId) ?? null;
  const entries = ranked.slice(0, LEADERBOARD_LIMIT);

  return { period, entries, me };
}

export async function getMyAttendance(
  clubId: string,
  period: AttendancePeriod,
  userId: string,
): Promise<AttendanceLeaderboardEntry | null> {
  const { me } = await getAttendanceLeaderboard(clubId, period, userId);
  return me;
}
