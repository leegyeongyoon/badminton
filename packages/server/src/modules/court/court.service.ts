import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus, CourtGameType } from '@badminton/shared';
import type { UpdateCourtInput } from '@badminton/shared';
import { getIO } from '../../socket';

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

// NOTE: Facility-LEVEL court createCourt/listCourts (clubSessionId = null) were
// retired with the old facility-admin dashboard. Per-정모 courts are created and
// listed via the club session (getSessionCourts), not here.

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

// ─────────────────────────────────────────────────────────────
// 진행 중인 게임을 다른 '빈' 코트로 이동(코트 잘못 넣었을 때 코트명 변경 대신).
// 소스 코트의 활성 턴(PLAYING/WAITING)을 대상 코트로 옮긴다: CourtTurn·Game·
// GameBoardEntry 의 courtId 를 갱신하고 코트 상태(소스→EMPTY, 대상→IN_USE)를 맞춘 뒤
// 소켓으로 브로드캐스트. 게임 자체(선수·시작시각·경과)는 그대로 유지된다.
export async function moveCourtGame(sourceCourtId: string, targetCourtId: string, userId: string) {
  if (sourceCourtId === targetCourtId) throw new BadRequestError('같은 코트로는 옮길 수 없어요');

  const source = await prisma.court.findUnique({ where: { id: sourceCourtId } });
  if (!source) throw new NotFoundError('코트');
  const target = await prisma.court.findUnique({ where: { id: targetCourtId } });
  if (!target) throw new NotFoundError('대상 코트');
  if (source.facilityId !== target.facilityId) throw new BadRequestError('같은 시설의 코트끼리만 옮길 수 있어요');
  if (target.status === CourtStatus.MAINTENANCE) throw new BadRequestError('점검 중인 코트로는 옮길 수 없어요');

  // 권한: 코트 관리 권한(클럽 LEADER/STAFF 또는 시설 관리자).
  await verifyCourtManager(userId, source.facilityId);

  // 소스의 활성 턴(진행 중 우선). 없으면 옮길 게임이 없음.
  const turn = await prisma.courtTurn.findFirst({
    where: { courtId: sourceCourtId, status: { in: ['PLAYING', 'WAITING'] } },
    orderBy: [{ status: 'asc' }, { position: 'asc' }], // PLAYING < WAITING(알파벳), position 낮은 것
  });
  if (!turn) throw new BadRequestError('이 코트에 옮길 게임이 없어요');

  // 대상 코트에 이미 활성 게임이 있으면 불가(빈 코트에만).
  const occupied = await prisma.courtTurn.findFirst({
    where: { courtId: targetCourtId, status: { in: ['PLAYING', 'WAITING'] } },
  });
  if (occupied) throw new BadRequestError('대상 코트가 이미 사용 중이에요. 빈 코트로 옮겨주세요');

  await prisma.$transaction(async (tx) => {
    await tx.courtTurn.update({ where: { id: turn.id }, data: { courtId: targetCourtId } });
    await tx.game.updateMany({ where: { turnId: turn.id }, data: { courtId: targetCourtId } });
    await tx.gameBoardEntry.updateMany({ where: { turnId: turn.id }, data: { courtId: targetCourtId } });
    // 소스에 다른 활성 턴이 없으면 EMPTY 로, 대상은 소스와 같은 상태(IN_USE)로.
    const remain = await tx.courtTurn.count({ where: { courtId: sourceCourtId, status: { in: ['PLAYING', 'WAITING'] } } });
    await tx.court.update({ where: { id: sourceCourtId }, data: { status: remain > 0 ? CourtStatus.IN_USE : CourtStatus.EMPTY } });
    await tx.court.update({ where: { id: targetCourtId }, data: { status: CourtStatus.IN_USE } });
  });

  // 실시간 반영 — 운영판/현황판/모니터가 코트 상태·게임보드 갱신.
  try {
    const io = getIO();
    io.to(`facility:${source.facilityId}`).emit('court:statusChanged', { courtId: sourceCourtId });
    io.to(`facility:${source.facilityId}`).emit('court:statusChanged', { courtId: targetCourtId });
    io.to(`facility:${source.facilityId}`).emit('clubSession:courtsUpdated', { facilityId: source.facilityId });
  } catch { /* 소켓 미연결 시 무시 */ }

  return { success: true, turnId: turn.id, from: sourceCourtId, to: targetCourtId };
}
