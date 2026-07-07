import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../../utils/prisma';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../../utils/errors';
import { verifyClubStaff, deleteSessionCascade, isSuperAdmin } from '../clubSession/clubSession.service';
import { cleanupTurnsOnCheckout } from '../checkin/checkin.service';
import { getIO } from '../../socket';
import type {
  CreateClubInput,
  UpdateClubInput,
  ClubMemberResponse,
  AttendancePeriod,
  AttendanceLeaderboardEntry,
  AttendanceLeaderboardResponse,
  ManagedMemberInput,
  BulkAddManagedMembersResponse,
  ManagedMemberResponse,
  MemberAttendanceResponse,
  DuesSettlementResponse,
  DuesMemberItem,
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
    description: club.description,
    inviteCode: club.inviteCode,
    homeFacilityId: club.homeFacilityId,
    monthlyDuesAmount: club.monthlyDuesAmount,
    memberCount: club._count.members,
    createdAt: club.createdAt.toISOString(),
  };
}

/**
 * Verify the requester may operate on this club's settings: SUPER_ADMIN (global
 * role) bypasses; otherwise the requester must be this club's LEADER. Returns the
 * club row. Used by updateClub / regenerateInviteCode. (Distinct from
 * verifyClubStaff, which also allows STAFF — settings edits are LEADER-only.)
 */
async function verifyClubLeaderOrSuperAdmin(
  clubId: string,
  requesterId: string,
  requesterRole: string,
) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new NotFoundError('모임');

  // 슈퍼관리자 판정은 토큰 role 뿐 아니라 DB(isSuperAdmin)로도 확인한다.
  // 최근 SUPER_ADMIN 으로 승격됐지만 아직 재로그인 전(토큰에 옛 role)이어도 전권이 통하도록.
  const superAdmin = requesterRole === 'SUPER_ADMIN' || (await isSuperAdmin(requesterId));
  if (!superAdmin) {
    const member = await prisma.clubMember.findUnique({
      where: { userId_clubId: { userId: requesterId, clubId } },
    });
    if (!member || member.role !== 'LEADER') {
      throw new ForbiddenError('모임 리더만 수정할 수 있습니다');
    }
  }
  return club;
}

/**
 * Update a 모임's info (LEADER of the club OR SUPER_ADMIN). At least one field is
 * required (enforced by updateClubSchema). homeFacilityId, when given non-null, is
 * validated to be a real Facility. Passing null clears the home facility /
 * description. Returns the updated club.
 */
export async function updateClub(
  clubId: string,
  requesterId: string,
  requesterRole: string,
  input: UpdateClubInput,
) {
  await verifyClubLeaderOrSuperAdmin(clubId, requesterId, requesterRole);

  // Validate the home facility exists when a non-null id is provided.
  if (input.homeFacilityId) {
    const facility = await prisma.facility.findUnique({
      where: { id: input.homeFacilityId },
      select: { id: true },
    });
    if (!facility) throw new NotFoundError('시설');
  }

  // Build a partial update only from the fields actually present in the body so
  // unspecified fields are left untouched (and explicit null clears them).
  const data: {
    name?: string;
    homeFacilityId?: string | null;
    description?: string | null;
    monthlyDuesAmount?: number | null;
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.homeFacilityId !== undefined) data.homeFacilityId = input.homeFacilityId;
  if (input.description !== undefined) {
    // Normalize empty/whitespace-only description to null (소개 제거).
    const trimmed = input.description?.trim();
    data.description = trimmed ? trimmed : null;
  }
  // 월 회비 표준 금액: null 로 회비 기능 해제, 숫자로 설정.
  if (input.monthlyDuesAmount !== undefined) data.monthlyDuesAmount = input.monthlyDuesAmount;

  const club = await prisma.club.update({
    where: { id: clubId },
    data,
    include: { _count: { select: { members: true } } },
  });

  return {
    id: club.id,
    name: club.name,
    description: club.description,
    inviteCode: club.inviteCode,
    homeFacilityId: club.homeFacilityId,
    monthlyDuesAmount: club.monthlyDuesAmount,
    memberCount: club._count.members,
    createdAt: club.createdAt.toISOString(),
  };
}

/**
 * Regenerate a fresh, unique invite code for the club (LEADER or SUPER_ADMIN).
 * The OLD code/QR/link stops working immediately — that's intended (e.g. to cut
 * off a leaked link). Retries on the rare unique-collision. Returns the new code.
 */
export async function regenerateInviteCode(
  clubId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ inviteCode: string }> {
  await verifyClubLeaderOrSuperAdmin(clubId, requesterId, requesterRole);

  // Retry on unique clash (generateInviteCode is random; collisions are very rare).
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    try {
      await prisma.club.update({ where: { id: clubId }, data: { inviteCode } });
      return { inviteCode };
    } catch (err: any) {
      // P2002 = unique constraint failed → regenerate and retry.
      if (err?.code === 'P2002') continue;
      throw err;
    }
  }
  throw new ConflictError('초대코드 재발급에 실패했습니다. 다시 시도해 주세요');
}

export async function listMyClubs(userId: string, role?: string) {
  // 최고관리자(SUPER_ADMIN)는 앱의 모든 모임을 보고/운영/관리할 수 있다.
  // 멤버십과 무관하게 전체 모임을 같은 응답 형태로 반환하며, 모든 모임에 대해
  // 리더 권한(role: 'LEADER')으로 표시한다. 그 외 사용자는 동작 변화 없음(본인 멤버십만).
  // 토큰 role 이 옛것(승격 전 로그인)이어도 DB(isSuperAdmin)로 확인해 전체 모임을 준다.
  if (role === 'SUPER_ADMIN' || (await isSuperAdmin(userId))) {
    const clubs = await prisma.club.findMany({
      include: { _count: { select: { members: true } } },
    });
    return clubs.map((club) => ({
      id: club.id,
      name: club.name,
      description: club.description,
      inviteCode: club.inviteCode,
      homeFacilityId: club.homeFacilityId,
      monthlyDuesAmount: club.monthlyDuesAmount,
      memberCount: club._count.members,
      role: 'LEADER' as ClubMemberRole,
      createdAt: club.createdAt.toISOString(),
    }));
  }

  const memberships = await prisma.clubMember.findMany({
    where: { userId },
    include: {
      club: { include: { _count: { select: { members: true } } } },
    },
  });

  return memberships.map((m) => ({
    id: m.club.id,
    name: m.club.name,
    description: m.club.description,
    inviteCode: m.club.inviteCode,
    homeFacilityId: m.club.homeFacilityId,
    monthlyDuesAmount: m.club.monthlyDuesAmount,
    memberCount: m.club._count.members,
    role: m.role,
    createdAt: m.club.createdAt.toISOString(),
  }));
}

export async function joinClub(userId: string, inviteCode: string) {
  // 운영자 회원가입 승인 대기(PENDING)/거절(REJECTED) 계정은 아직 앱을 쓸 수 없으므로
  // 초대코드 가입도 막는다(승인 대기 벽 우회 방지).
  const joiner = await prisma.user.findUnique({ where: { id: userId }, select: { accountStatus: true } });
  if (joiner && joiner.accountStatus !== 'ACTIVE') {
    throw new ForbiddenError('승인 대기 중인 계정입니다. 최고관리자 승인 후 이용해 주세요');
  }

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
 * HARD-delete a 모임 (모임 삭제) and ALL of its descendants. Auth: SUPER_ADMIN
 * (global role) OR LEADER/STAFF of the club.
 *
 * Cascade vs manual: the schema cascades Club→ClubMember / Club→ClubSession /
 * Club→ClubMessage, but NOT ClubSession→CourtTurn / ClubSession→GameBoard (and
 * GameBoardEntry's court/turn FKs have no cascade). So a single
 * prisma.club.delete would fail on those dangling rows. We delete each session's
 * subtree via the shared deleteSessionCascade (FK-safe bottom-up:
 * boardEntries→board→games→turns→checkins→courts→session), THEN delete the club
 * (which cascades the remaining ClubMember + ClubMessage rows). Everything runs in
 * one transaction so no orphans remain.
 */
export async function deleteClub(
  clubId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ success: true }> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true },
  });
  if (!club) throw new NotFoundError('모임');

  // SUPER_ADMIN bypasses the per-club staff check; everyone else must be
  // LEADER/STAFF of this club. (토큰 role 이 옛것이어도 DB 로 슈퍼관리자면 통과.)
  const superAdmin = requesterRole === 'SUPER_ADMIN' || (await isSuperAdmin(requesterId));
  if (!superAdmin) {
    await verifyClubStaff(clubId, requesterId);
  }

  const sessions = await prisma.clubSession.findMany({
    where: { clubId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Delete every session's subtree first (the parts that don't cascade from
    // the club), then the club row (cascades ClubMember + ClubMessage).
    for (const s of sessions) {
      await deleteSessionCascade(tx, s.id);
    }
    await tx.club.delete({ where: { id: clubId } });
  });

  return { success: true };
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
      // Effective PER-CLUB 급수 (모임별 급수): the operator-set ClubMember override
      // wins for this club, else the user's own default (PlayerProfile.skillLevel).
      skillLevel: (m.skillLevel ?? m.user.profile?.skillLevel ?? null) as SkillLevel | null,
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
// 급수 is PER-CLUB (모임별 급수): it's written to this member's ClubMember.skillLevel,
// which OVERRIDES the user's own default (PlayerProfile.skillLevel) FOR THIS CLUB
// ONLY and is locked from the user's self-edit. The target is by definition a member
// here, so there's always a ClubMember row to write. gender stays global on the
// PlayerProfile (not per-club). The returned skillLevel is the effective per-club value.
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
          profile: { select: { skillLevel: true, gender: true } },
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

  // 급수 → PER-CLUB override on the ClubMember row (this club only).
  let overrideSkill = (target.skillLevel ?? null) as SkillLevel | null;
  if (data.skillLevel !== undefined) {
    const updatedMember = await prisma.clubMember.update({
      where: { userId_clubId: { userId: targetUserId, clubId } },
      data: { skillLevel: data.skillLevel as any },
      select: { skillLevel: true },
    });
    overrideSkill = (updatedMember.skillLevel ?? null) as SkillLevel | null;
  }

  // gender stays GLOBAL on the PlayerProfile (no per-club gender).
  let profileSkill = (target.user.profile?.skillLevel ?? null) as SkillLevel | null;
  let profileGender = target.user.profile?.gender ?? null;
  if (data.gender !== undefined) {
    const profile = await prisma.playerProfile.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, gender: data.gender },
      update: { gender: data.gender },
      select: { skillLevel: true, gender: true },
    });
    profileSkill = (profile.skillLevel ?? null) as SkillLevel | null;
    profileGender = profile.gender ?? null;
  }

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
    // Effective per-club 급수: ClubMember override wins, else the user's own default.
    skillLevel: overrideSkill ?? profileSkill,
    gender: profileGender,
    isCheckedIn,
    facilityId: target.user.checkIns[0]?.facilityId ?? null,
    playerStatus,
  };
}

/**
 * Remove a member from a club (모임에서 내보내기). Auth: the club's LEADER OR a
 * global SUPER_ADMIN (reuses verifyClubLeaderOrSuperAdmin). Guards:
 *  - the target must be a member of this club (404 otherwise);
 *  - a LEADER cannot remove themselves (they must transfer leadership / demote
 *    first — otherwise the club would be left leaderless);
 *  - another LEADER cannot be removed (demote them to STAFF/MEMBER first), so we
 *    never silently drop a co-leader.
 *
 * Effect (one transaction): if the member has an OPEN check-in in any of this
 * club's ACTIVE 정모 sessions (or a facility-only check-in at one of those
 * facilities), they're checked out and their WAITING turns / QUEUED board entries
 * are cleaned up first (reusing cleanupTurnsOnCheckout — the same logic as
 * self/operator checkout). Then the ClubMember row is deleted. Managed-member
 * users (isManaged) are left as harmless orphan users — only the membership goes.
 * Socket events (checkin:left + players refresh) are emitted so operator/member
 * boards react immediately. Returns { success: true }.
 */
export async function removeMember(
  clubId: string,
  targetUserId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ success: true }> {
  await verifyClubLeaderOrSuperAdmin(clubId, requesterId, requesterRole);

  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  // A LEADER can't remove themselves — they'd leave the club leaderless.
  if (targetUserId === requesterId && target.role === 'LEADER') {
    throw new BadRequestError('대표는 자신을 내보낼 수 없습니다. 먼저 대표를 위임하세요');
  }

  // Another LEADER can't be removed directly — demote to 운영진/회원 first.
  if (target.role === 'LEADER' && targetUserId !== requesterId) {
    throw new BadRequestError('다른 대표는 내보낼 수 없습니다. 먼저 역할을 변경하세요');
  }

  // OPEN check-ins for this user that belong to THIS club's ACTIVE sessions —
  // either session-scoped rows or facility-only rows at those sessions' facilities.
  const activeSessions = await prisma.clubSession.findMany({
    where: { clubId, status: 'ACTIVE' },
    select: { id: true, facilityId: true },
  });
  const activeSessionIds = activeSessions.map((s) => s.id);
  const activeFacilityIds = [...new Set(activeSessions.map((s) => s.facilityId))];

  const openCheckIns =
    activeSessions.length > 0
      ? await prisma.checkIn.findMany({
          where: {
            userId: targetUserId,
            checkedOutAt: null,
            OR: [
              { clubSessionId: { in: activeSessionIds } },
              { clubSessionId: null, facilityId: { in: activeFacilityIds } },
            ],
          },
          select: { id: true, facilityId: true, clubSessionId: true },
        })
      : [];

  // Close the check-ins + delete the membership atomically.
  await prisma.$transaction(async (tx) => {
    if (openCheckIns.length > 0) {
      await tx.checkIn.updateMany({
        where: { id: { in: openCheckIns.map((c) => c.id) } },
        data: { checkedOutAt: new Date() },
      });
    }
    await tx.clubMember.delete({
      where: { userId_clubId: { userId: targetUserId, clubId } },
    });
  });

  // Post-commit: clean turns/board for each closed check-in (cancels WAITING
  // turns, strips QUEUED board entries, leaves PLAYING intact) and emit the
  // standard left/refresh socket events so boards update. Resolve the session id
  // for board cleanup — prefer the row's own, else the lone active session at that
  // facility (handled inside cleanupTurnsOnCheckout when undefined).
  const io = getIO();
  for (const ci of openCheckIns) {
    const sessionId =
      ci.clubSessionId ??
      activeSessions.find((s) => s.facilityId === ci.facilityId)?.id;
    await cleanupTurnsOnCheckout(targetUserId, ci.facilityId, sessionId ?? undefined);
    const leftPayload = { userId: targetUserId, facilityId: ci.facilityId };
    io.to(`facility:${ci.facilityId}`).emit('checkin:left', leftPayload);
    if (sessionId) io.to(`clubSession:${sessionId}`).emit('checkin:left', leftPayload);
  }

  return { success: true };
}

/**
 * 멤버 출석 기록 삭제 — 이 모임의 정모(ClubSession)에 묶인 그 회원의 CheckIn 행을 모두
 * 삭제한다(출석왕 카운트 0). 멤버십·역할은 유지. 시설 레벨(clubSessionId=null) 행은
 * 건드리지 않는다. 잘못 들어간 출석(예: 과거 자동출석)을 운영자가 정리할 때 사용.
 * Auth: 이 모임의 LEADER(또는 SUPER_ADMIN).
 */
export async function clearMemberAttendance(
  clubId: string,
  targetUserId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ deleted: number }> {
  await verifyClubLeaderOrSuperAdmin(clubId, requesterId, requesterRole);

  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  const result = await prisma.checkIn.deleteMany({
    where: { userId: targetUserId, clubSession: { clubId } },
  });
  return { deleted: result.count };
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
  if (!member) {
    // 최고관리자는 비멤버여도 조회 가능(전역 우회).
    if (await isSuperAdmin(userId)) return member;
    throw new ForbiddenError('모임 멤버만 조회할 수 있습니다');
  }
  return member;
}

// Returns the [start, end) Date range for a period (server-local calendar).
//  - 'all'         → 무제한
//  - 'year'        → 올해 1/1 ~ (상한 없음)
//  - 'month'       → 이번 달 1일 ~ (상한 없음, 하위호환)
//  - 'YYYY-MM'     → 그 달 1일 ~ 다음 달 1일(미포함) — 특정 월만 집계
function periodRange(period: AttendancePeriod): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (period === 'all') return { start: null, end: null };
  if (period === 'year') return { start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0), end: null };
  if (period === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), end: null };
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1; // 0-based
    // new Date(y, mo+1, 1) 는 12월이면 자동으로 다음 해 1월로 넘어간다.
    return { start: new Date(y, mo, 1, 0, 0, 0, 0), end: new Date(y, mo + 1, 1, 0, 0, 0, 0) };
  }
  return { start: null, end: null };
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

  const { start, end } = periodRange(period);

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
      ...(start || end
        ? { checkedInAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
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
  // Effective PER-CLUB 급수: the operator-set ClubMember override wins, else the
  // user's own default (PlayerProfile.skillLevel).
  const rows = members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    skillLevel: (m.skillLevel ?? m.user.profile?.skillLevel ?? null) as SkillLevel | null,
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

// --- Member attendance history (멤버별 출석 이력) ---

/**
 * The 정모s a member attended in THIS club, most-recent first. Attendance =
 * DISTINCT ClubSession the member checked into (CheckIn.clubSessionId scoped to
 * ClubSession.clubId === clubId), the same scoping the leaderboard uses.
 *
 * Auth: the club's LEADER/STAFF, OR the user themselves (a member may view their
 * own history). Anyone else (non-staff, not self) → 403.
 */
export async function getMemberAttendance(
  clubId: string,
  targetUserId: string,
  requesterId: string,
): Promise<MemberAttendanceResponse> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true } });
  if (!club) throw new NotFoundError('모임');

  // LEADER/STAFF of this club, or the requester asking for their own history.
  if (requesterId !== targetUserId) {
    const requester = await prisma.clubMember.findUnique({
      where: { userId_clubId: { userId: requesterId, clubId } },
    });
    if (!requester || (requester.role !== 'LEADER' && requester.role !== 'STAFF')) {
      throw new ForbiddenError('운영진만 다른 멤버의 출석을 볼 수 있습니다');
    }
  }

  // The target must be a member of this club.
  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: targetUserId, clubId } },
  });
  if (!target) throw new NotFoundError('모임 멤버');

  // All check-ins of this member into THIS club's 정모s. Pull the session so we
  // can return title/startedAt; dedupe by clubSessionId (one row per 정모).
  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: targetUserId,
      clubSessionId: { not: null },
      clubSession: { clubId },
    },
    select: {
      clubSessionId: true,
      clubSession: { select: { title: true, startedAt: true } },
    },
  });

  const seen = new Map<string, { sessionId: string; title: string | null; startedAt: Date }>();
  for (const c of checkIns) {
    if (!c.clubSessionId || !c.clubSession) continue;
    if (seen.has(c.clubSessionId)) continue;
    seen.set(c.clubSessionId, {
      sessionId: c.clubSessionId,
      title: c.clubSession.title ?? null,
      startedAt: c.clubSession.startedAt,
    });
  }

  // Most-recent first.
  const sessions = [...seen.values()]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      startedAt: s.startedAt.toISOString(),
    }));

  return { sessions, count: sessions.length };
}

// --- Monthly dues (월 회비) ---

/** Current calendar month as "YYYY-MM" (server-side default period). */
function currentPeriod(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Per-member monthly dues for a period (LEADER/STAFF). For each non-guest member:
 * paid (a DuesPayment row exists for (clubId,userId,period)) + amount (that
 * payment's amount, else the club's monthlyDuesAmount). Plus totals.
 *
 * `expected` = memberCount × monthlyDuesAmount (0 when the amount is unset);
 * `paid` = sum of the paid members' amounts.
 */
export async function getDues(
  clubId: string,
  period: string,
  requesterId: string,
): Promise<DuesSettlementResponse> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, monthlyDuesAmount: true },
  });
  if (!club) throw new NotFoundError('모임');
  await verifyClubStaff(clubId, requesterId);

  // Non-guest members of this club.
  const members = await prisma.clubMember.findMany({
    where: { clubId, user: { isGuest: false } },
    include: { user: { select: { id: true, name: true } } },
  });

  // Payments for this period, keyed by userId.
  const payments = await prisma.duesPayment.findMany({
    where: { clubId, period },
    select: { userId: true, amount: true },
  });
  const paidByUser = new Map<string, number>();
  for (const p of payments) paidByUser.set(p.userId, p.amount);

  const standard = club.monthlyDuesAmount ?? 0;

  const items: DuesMemberItem[] = members.map((m) => {
    const paidAmount = paidByUser.get(m.userId);
    const paid = paidAmount !== undefined;
    return {
      userId: m.userId,
      name: m.user.name,
      paid,
      // Paid → the recorded amount; unpaid → the club's standard expected amount.
      amount: paid ? paidAmount! : standard,
    };
  });

  // Stable ordering by name.
  items.sort((a, b) => a.name.localeCompare(b.name));

  const expected = members.length * standard;
  let paidTotal = 0;
  let paidCount = 0;
  for (const it of items) {
    if (it.paid) {
      paidTotal += it.amount;
      paidCount += 1;
    }
  }

  return {
    clubId,
    period,
    monthlyDuesAmount: club.monthlyDuesAmount,
    items,
    totals: {
      expected,
      paid: paidTotal,
      unpaid: expected - paidTotal,
      paidCount,
      unpaidCount: members.length - paidCount,
    },
  };
}

/**
 * Mark a member paid / unpaid for a period (LEADER/STAFF).
 *  - paid=true  → upsert a DuesPayment (amount = amount ?? club.monthlyDuesAmount
 *                 ?? 0; recordedById = requester).
 *  - paid=false → delete the DuesPayment for (clubId,userId,period).
 * Returns the refreshed settlement summary for the period.
 */
export async function setDues(
  clubId: string,
  requesterId: string,
  input: { userId: string; period: string; paid: boolean; amount?: number },
): Promise<DuesSettlementResponse> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, monthlyDuesAmount: true },
  });
  if (!club) throw new NotFoundError('모임');
  await verifyClubStaff(clubId, requesterId);

  // The target must be a (non-guest) member of this club.
  const target = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId: input.userId, clubId } },
    include: { user: { select: { isGuest: true } } },
  });
  if (!target || target.user.isGuest) throw new NotFoundError('모임 멤버');

  if (input.paid) {
    const amount = input.amount ?? club.monthlyDuesAmount ?? 0;
    await prisma.duesPayment.upsert({
      where: { clubId_userId_period: { clubId, userId: input.userId, period: input.period } },
      create: {
        clubId,
        userId: input.userId,
        period: input.period,
        amount,
        recordedById: requesterId,
      },
      update: { amount, recordedById: requesterId, paidAt: new Date() },
    });
  } else {
    // deleteMany so reverting an already-unpaid member is a harmless no-op.
    await prisma.duesPayment.deleteMany({
      where: { clubId, userId: input.userId, period: input.period },
    });
  }

  return getDues(clubId, input.period, requesterId);
}
