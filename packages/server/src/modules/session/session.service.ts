import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors';
import { getIO } from '../../socket';
import { logger } from '../../utils/logger';
import type { FacilitySessionResponse } from '@badminton/shared';

export async function openSession(
  facilityId: string,
  userId: string,
  note?: string,
): Promise<FacilitySessionResponse> {
  // Check if there is already an open session
  const existingSession = await prisma.facilitySession.findFirst({
    where: { facilityId, status: 'OPEN' },
  });
  if (existingSession) throw new ConflictError('이미 열려있는 세션이 있습니다');

  const session = await prisma.facilitySession.create({
    data: {
      facilityId,
      openedById: userId,
      note: note ?? null,
    },
    include: { openedBy: true },
  });

  const io = getIO();
  io.to(`facility:${facilityId}`).emit('session:opened', {
    facilityId,
    sessionId: session.id,
  });

  logger.info(`Session opened for facility ${facilityId} by user ${userId}`);

  return {
    id: session.id,
    facilityId: session.facilityId,
    openedById: session.openedById,
    openedByName: session.openedBy.name,
    status: session.status as any,
    openedAt: session.openedAt.toISOString(),
    closedAt: null,
    note: session.note,
  };
}

export async function closeSession(
  sessionId: string,
  userId: string,
): Promise<FacilitySessionResponse> {
  const session = await prisma.facilitySession.findUnique({
    where: { id: sessionId },
    include: { openedBy: true, facility: true },
  });
  if (!session) throw new NotFoundError('세션');
  if (session.status !== 'OPEN') throw new BadRequestError('이미 종료된 세션입니다');

  const facilityId = session.facilityId;

  // Close the session
  const closedSession = await prisma.facilitySession.update({
    where: { id: sessionId },
    data: { status: 'CLOSED', closedAt: new Date() },
    include: { openedBy: true },
  });

  // Cancel all active turns (WAITING and PLAYING)
  const activeTurns = await prisma.courtTurn.findMany({
    where: {
      court: { facilityId },
      status: { in: ['WAITING', 'PLAYING'] },
    },
  });
  for (const turn of activeTurns) {
    await prisma.courtTurn.update({
      where: { id: turn.id },
      data: { status: 'CANCELLED' },
    });
  }

  // Cancel active games
  await prisma.game.updateMany({
    where: {
      court: { facilityId },
      status: 'IN_PROGRESS',
    },
    data: { status: 'CANCELLED' },
  });

  // End all active club sessions for this facility
  await prisma.clubSession.updateMany({
    where: { facilityId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  // Set all courts back to EMPTY
  await prisma.court.updateMany({
    where: { facilityId, status: { not: 'MAINTENANCE' } },
    data: { status: 'EMPTY' },
  });

  const io = getIO();
  io.to(`facility:${facilityId}`).emit('session:closed', { facilityId });

  logger.info(`Session ${sessionId} closed for facility ${facilityId} by user ${userId}`);

  return {
    id: closedSession.id,
    facilityId: closedSession.facilityId,
    openedById: closedSession.openedById,
    openedByName: closedSession.openedBy.name,
    status: closedSession.status as any,
    openedAt: closedSession.openedAt.toISOString(),
    closedAt: closedSession.closedAt?.toISOString() ?? null,
    note: closedSession.note,
  };
}

export async function getCurrentSession(facilityId: string): Promise<FacilitySessionResponse | null> {
  const session = await prisma.facilitySession.findFirst({
    where: { facilityId, status: 'OPEN' },
    include: { openedBy: true },
    orderBy: { openedAt: 'desc' },
  });

  if (!session) return null;

  return {
    id: session.id,
    facilityId: session.facilityId,
    openedById: session.openedById,
    openedByName: session.openedBy.name,
    status: session.status as any,
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    note: session.note,
  };
}
