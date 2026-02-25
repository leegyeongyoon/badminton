import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { getIO } from '../../socket/index';
import type { ClubSessionResponse } from '@badminton/shared';

async function verifyClubStaff(clubId: string, userId: string) {
  const member = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId } },
  });
  if (!member || (member.role !== 'LEADER' && member.role !== 'STAFF')) {
    throw new ForbiddenError('모임 리더 또는 스태프만 가능합니다');
  }
  return member;
}

function mapClubSession(session: any): ClubSessionResponse {
  return {
    id: session.id,
    clubId: session.clubId,
    clubName: session.club.name,
    facilityId: session.facilityId,
    facilityName: session.facility.name,
    facilitySessionId: session.facilitySessionId,
    startedById: session.startedById,
    startedByName: session.startedBy.name,
    status: session.status,
    courtIds: session.courtIds,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

export async function startSession(
  clubId: string,
  userId: string,
  input: { facilityId: string; courtIds?: string[] },
): Promise<ClubSessionResponse> {
  await verifyClubStaff(clubId, userId);

  // Verify facility has open session
  const facilitySession = await prisma.facilitySession.findFirst({
    where: { facilityId: input.facilityId, status: 'OPEN' },
  });
  if (!facilitySession) {
    throw new BadRequestError('시설에 열린 세션이 없습니다');
  }

  // Check no active club session for this club
  const existing = await prisma.clubSession.findFirst({
    where: { clubId, status: 'ACTIVE' },
  });
  if (existing) {
    throw new BadRequestError('이미 진행 중인 모임 세션이 있습니다');
  }

  const session = await prisma.clubSession.create({
    data: {
      clubId,
      facilityId: input.facilityId,
      facilitySessionId: facilitySession.id,
      startedById: userId,
      courtIds: input.courtIds ?? [],
    },
    include: {
      club: true,
      facility: true,
      startedBy: true,
    },
  });

  const mapped = mapClubSession(session);

  const io = getIO();
  io.to(`facility:${input.facilityId}`).emit('clubSession:started', mapped);

  return mapped;
}

export async function getSession(sessionId: string): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  return mapClubSession(session);
}

export async function getActiveSession(clubId: string): Promise<ClubSessionResponse | null> {
  const session = await prisma.clubSession.findFirst({
    where: { clubId, status: 'ACTIVE' },
    include: {
      club: true,
      facility: true,
      startedBy: true,
    },
  });

  if (!session) return null;
  return mapClubSession(session);
}

export async function updateCourts(
  sessionId: string,
  userId: string,
  courtIds: string[],
): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션만 수정할 수 있습니다');
  }

  await verifyClubStaff(session.clubId, userId);

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: { courtIds },
    include: { club: true, facility: true, startedBy: true },
  });

  const mapped = mapClubSession(updated);

  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:courtsUpdated', mapped);

  return mapped;
}

export async function endSession(
  sessionId: string,
  userId: string,
): Promise<ClubSessionResponse> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { club: true, facility: true, startedBy: true },
  });
  if (!session) throw new NotFoundError('모임 세션');
  if (session.status !== 'ACTIVE') {
    throw new BadRequestError('활성 세션만 종료할 수 있습니다');
  }

  await verifyClubStaff(session.clubId, userId);

  const updated = await prisma.clubSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date() },
    include: { club: true, facility: true, startedBy: true },
  });

  const io = getIO();
  io.to(`facility:${session.facilityId}`).emit('clubSession:ended', {
    clubSessionId: sessionId,
    clubId: session.clubId,
  });

  return mapClubSession(updated);
}
