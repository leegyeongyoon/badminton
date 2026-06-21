import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus, CourtGameType } from '@badminton/shared';
import type { CreateCourtInput, UpdateCourtInput } from '@badminton/shared';

/**
 * Court-management permission for a club operator.
 *
 * A court may be created/renamed/marked unavailable BEFORE a session is bound to
 * a facility, and clubs are not 1:1 with facilities, so a clean per-facility staff
 * check is not reliably derivable. Per the product decision (low risk for this
 * app) we allow any club LEADER/STAFF (role on ANY club), OR a FACILITY_ADMIN of
 * the target facility, to manage courts.
 *
 * Throws ForbiddenError if the user is neither.
 */
export async function verifyCourtManager(userId: string, facilityId?: string) {
  // FACILITY_ADMIN of the target facility (when known).
  if (facilityId) {
    const admin = await prisma.facilityAdmin.findFirst({
      where: { userId, facilityId },
    });
    if (admin) return;
  }

  // Any club LEADER/STAFF may manage courts.
  const staffMembership = await prisma.clubMember.findFirst({
    where: { userId, role: { in: ['LEADER', 'STAFF'] } },
  });
  if (staffMembership) return;

  throw new ForbiddenError('코트 관리는 시설 관리자 또는 모임 대표/운영진만 가능합니다');
}

export function getPlayersRequired(gameType: CourtGameType): number {
  switch (gameType) {
    case CourtGameType.DOUBLES:
      return 4;
    case CourtGameType.LESSON:
      return 2; // minimum for lesson
    default:
      return 4;
  }
}

// Facility-admin dashboard court creation: a facility-level court
// (clubSessionId = null). Clash is checked only among other facility-level
// courts — 정모-owned courts (clubSessionId != null) live in their own namespace.
export async function createCourt(facilityId: string, input: CreateCourtInput) {
  const gameType = input.gameType || CourtGameType.DOUBLES;
  const clash = await prisma.court.findFirst({
    where: { facilityId, clubSessionId: null, name: input.name },
  });
  if (clash) throw new BadRequestError('같은 이름의 코트가 이미 있습니다');
  return prisma.court.create({
    data: { name: input.name, facilityId, gameType },
  });
}

// Facility-admin dashboard court list: facility-level courts only
// (clubSessionId = null). 정모-owned courts are managed inside their own 정모.
export async function listCourts(facilityId: string) {
  return prisma.court.findMany({
    where: { facilityId, clubSessionId: null },
    orderBy: { name: 'asc' },
    include: {
      turns: {
        where: { status: { in: ['WAITING', 'PLAYING'] } },
        orderBy: { position: 'asc' },
        include: {
          players: { include: { user: true } },
        },
      },
    },
  });
}

export async function updateCourt(courtId: string, input: UpdateCourtInput) {
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');

  // Rename: guard the (clubSessionId, name) unique constraint within the SAME
  // owner bucket (this 정모, or facility-level when clubSessionId is null).
  if (input.name && input.name !== court.name) {
    const clash = await prisma.court.findFirst({
      where: { clubSessionId: court.clubSessionId, name: input.name, id: { not: courtId } },
    });
    if (clash) throw new BadRequestError('같은 이름의 코트가 이미 있습니다');
  }

  return prisma.court.update({
    where: { id: courtId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.gameType && { gameType: input.gameType }),
    },
  });
}

export async function updateCourtStatus(courtId: string, status: 'MAINTENANCE' | 'EMPTY') {
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');

  if (status === 'MAINTENANCE') {
    // Can go to maintenance from any state (admin action)
  } else if (status === 'EMPTY') {
    if (court.status !== 'MAINTENANCE') {
      throw new BadRequestError('점검 상태인 코트만 활성화할 수 있습니다');
    }
  }

  return prisma.court.update({
    where: { id: courtId },
    data: { status },
  });
}

export async function deleteCourt(courtId: string) {
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (!court) throw new NotFoundError('코트');
  if (court.status === 'IN_USE') {
    throw new BadRequestError('사용 중인 코트는 삭제할 수 없습니다');
  }
  // Preserve history: if the court was ever used (has turns), don't delete it —
  // suggest marking it 사용 불가 instead.
  const turnCount = await prisma.courtTurn.count({ where: { courtId } });
  if (turnCount > 0) {
    throw new BadRequestError('사용 기록이 있는 코트는 삭제할 수 없어요. 대신 "사용 불가"로 두세요.');
  }
  await prisma.court.delete({ where: { id: courtId } });
  // Keep per-정모 ownership in sync: strip the deleted court id from any
  // ACTIVE ClubSession.courtIds that still references it (no orphan ids).
  const owning = await prisma.clubSession.findMany({
    where: { status: 'ACTIVE', courtIds: { has: courtId } },
    select: { id: true, courtIds: true },
  });
  for (const s of owning) {
    await prisma.clubSession.update({
      where: { id: s.id },
      data: { courtIds: { set: s.courtIds.filter((id) => id !== courtId) } },
    });
  }
  return { id: courtId };
}

// State machine transitions
export async function transitionCourtStatus(courtId: string, newStatus: CourtStatus) {
  return prisma.court.update({
    where: { id: courtId },
    data: { status: newStatus },
  });
}
