import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { CourtStatus, CourtGameType } from '@badminton/shared';
import type { CreateCourtInput, UpdateCourtInput } from '@badminton/shared';

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

export async function createCourt(facilityId: string, input: CreateCourtInput) {
  const gameType = input.gameType || CourtGameType.DOUBLES;
  return prisma.court.create({
    data: { name: input.name, facilityId, gameType },
  });
}

export async function listCourts(facilityId: string) {
  return prisma.court.findMany({
    where: { facilityId },
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
  return prisma.court.update({
    where: { id: courtId },
    data: { ...(input.gameType && { gameType: input.gameType }) },
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

// State machine transitions
export async function transitionCourtStatus(courtId: string, newStatus: CourtStatus) {
  return prisma.court.update({
    where: { id: courtId },
    data: { status: newStatus },
  });
}
