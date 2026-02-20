import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { CourtStatus } from '@badminton/shared';
import type { CreateCourtInput } from '@badminton/shared';

export async function createCourt(facilityId: string, input: CreateCourtInput) {
  return prisma.court.create({
    data: { name: input.name, facilityId },
  });
}

export async function listCourts(facilityId: string) {
  return prisma.court.findMany({
    where: { facilityId },
    orderBy: { name: 'asc' },
    include: {
      holds: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: { club: true, createdBy: true },
      },
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

// State machine transitions
export async function transitionCourtStatus(courtId: string, newStatus: CourtStatus) {
  return prisma.court.update({
    where: { id: courtId },
    data: { status: newStatus },
  });
}
