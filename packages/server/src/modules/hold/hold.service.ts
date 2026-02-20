import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus } from '@badminton/shared';
import { transitionCourtStatus } from '../court/court.service';
import { getIO } from '../../socket';
import { joinQueue } from '../queue/queue.service';
import { promoteNextInQueue } from '../queue/queue.service';

export async function createHold(courtId: string, userId: string, clubId: string) {
  // Delegate to joinQueue which handles both empty-court and queue scenarios
  const result = await joinQueue(courtId, userId, clubId);
  return result.hold;
}

export async function getHold(courtId: string) {
  const hold = await prisma.courtHold.findFirst({
    where: { courtId, status: 'ACTIVE' },
    include: {
      club: true,
      createdBy: true,
      court: { include: { facility: { include: { policy: true } } } },
      games: {
        orderBy: { order: 'asc' },
        include: { players: { include: { user: true } } },
      },
    },
  });
  if (!hold) return null;
  return {
    ...hold,
    slotsTotal: hold.court.facility.policy?.slotsPerCourt || 3,
  };
}

export async function releaseHold(holdId: string, userId: string) {
  const hold = await prisma.courtHold.findUnique({
    where: { id: holdId },
    include: {
      court: { include: { facility: true } },
      games: { where: { status: { in: ['CALLING', 'CONFIRMED', 'IN_PROGRESS'] } } },
    },
  });
  if (!hold) throw new NotFoundError('홀드');
  if (hold.status !== 'ACTIVE') throw new BadRequestError('이미 해제된 홀드입니다');

  if (hold.games.length > 0) {
    throw new BadRequestError('진행 중인 게임이 있어 홀드를 해제할 수 없습니다');
  }

  // Check permission: hold creator, club leader, or facility admin
  const isCreator = hold.createdById === userId;
  const isLeader = await prisma.clubMember.findFirst({
    where: { userId, clubId: hold.clubId, isLeader: true },
  });
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { userId, facilityId: hold.court.facilityId },
  });
  if (!isCreator && !isLeader && !isAdmin) {
    throw new ForbiddenError('홀드를 해제할 권한이 없습니다');
  }

  // Cancel any WAITING games
  await prisma.game.updateMany({
    where: { holdId, status: 'WAITING' },
    data: { status: 'CANCELLED' },
  });

  await prisma.courtHold.update({
    where: { id: holdId },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  await transitionCourtStatus(hold.courtId, CourtStatus.EMPTY);

  const io = getIO();
  io.to(`facility:${hold.court.facilityId}`).emit('court:statusChanged', {
    courtId: hold.courtId,
    status: CourtStatus.EMPTY,
  });
  io.to(`court:${hold.courtId}`).emit('hold:released', {
    holdId,
    courtId: hold.courtId,
  });

  // Check if there's anyone in the queue and promote them
  await promoteNextInQueue(hold.courtId);

  return { success: true };
}
