import { prisma } from '../../utils/prisma';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import { CourtGameType } from '@badminton/shared';
import type { CreateFacilityInput, UpdatePolicyInput, UpdateCoordinatesInput, DisplayBoardResponse, FacilityRequestResponse, BoardCourtData, ClubSessionInfo } from '@badminton/shared';
import { getPlayersRequired } from '../court/court.service';
import QRCode from 'qrcode';

export async function createFacility(userId: string, input: CreateFacilityInput) {
  const facility = await prisma.facility.create({
    data: {
      name: input.name,
      address: input.address,
      admins: { create: { userId } },
      policy: { create: {} },
    },
    include: { courts: true, policy: true },
  });

  if (input.totalCourts) {
    for (let i = 1; i <= input.totalCourts; i++) {
      await prisma.court.create({
        data: { name: `코트 ${i}`, facilityId: facility.id },
      });
    }
  }

  return prisma.facility.findUnique({
    where: { id: facility.id },
    include: { courts: true },
  });
}

export async function listFacilities() {
  const facilities = await prisma.facility.findMany({
    include: {
      courts: true,
      sessions: {
        where: { status: 'OPEN' },
        take: 1,
      },
      checkIns: {
        where: { checkedOutAt: null },
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return facilities.map((f) => ({
    id: f.id,
    name: f.name,
    address: f.address,
    latitude: f.latitude,
    longitude: f.longitude,
    qrCodeData: f.qrCodeData,
    courts: f.courts,
    createdAt: f.createdAt.toISOString(),
    courtCount: f.courts.length,
    hasOpenSession: f.sessions.length > 0,
    checkedInCount: f.checkIns.length,
  }));
}

export async function getFacility(id: string) {
  const facility = await prisma.facility.findUnique({
    where: { id },
    include: { courts: { orderBy: { name: 'asc' } } },
  });
  if (!facility) throw new NotFoundError('시설');
  return facility;
}

export async function getQrCode(id: string) {
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) throw new NotFoundError('시설');
  return QRCode.toDataURL(facility.qrCodeData);
}

export async function getPolicy(facilityId: string) {
  const policy = await prisma.facilityPolicy.findUnique({ where: { facilityId } });
  if (!policy) throw new NotFoundError('시설 정책');
  return policy;
}

export async function updatePolicy(facilityId: string, userId: string, input: UpdatePolicyInput) {
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('시설 관리자만 정책을 수정할 수 있습니다');

  return prisma.facilityPolicy.update({
    where: { facilityId },
    data: input,
  });
}

export async function updateCoordinates(facilityId: string, userId: string, input: UpdateCoordinatesInput) {
  const isAdmin = await prisma.facilityAdmin.findFirst({
    where: { facilityId, userId },
  });
  if (!isAdmin) throw new ForbiddenError('시설 관리자만 좌표를 수정할 수 있습니다');

  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new NotFoundError('시설');

  return prisma.facility.update({
    where: { id: facilityId },
    data: {
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
}

export async function getBoard(facilityId: string): Promise<BoardCourtData[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      policy: true,
      courts: {
        orderBy: { name: 'asc' },
        include: {
          turns: {
            where: { status: { in: ['WAITING', 'PLAYING'] } },
            orderBy: { position: 'asc' },
            include: {
              players: { include: { user: true } },
              createdBy: true,
              game: { include: { players: { include: { user: true } } } },
              clubSession: { include: { club: true } },
            },
          },
        },
      },
    },
  });
  if (!facility) throw new NotFoundError('시설');

  // Load active club sessions for this facility to check court assignments
  const activeClubSessions = await prisma.clubSession.findMany({
    where: { facilityId, status: 'ACTIVE' },
    include: { club: true },
  });

  const maxTurns = facility.policy?.maxTurnsPerCourt ?? 3;

  return facility.courts.map((court) => {
    // Determine clubSessionInfo: check if court is in any active ClubSession.courtIds
    let clubSessionInfo: ClubSessionInfo | null = null;
    for (const cs of activeClubSessions) {
      if (cs.courtIds.includes(court.id)) {
        clubSessionInfo = {
          clubSessionId: cs.id,
          clubId: cs.clubId,
          clubName: cs.club.name,
        };
        break;
      }
    }

    return {
      court: {
        id: court.id,
        name: court.name,
        facilityId: court.facilityId,
        status: court.status as any,
        gameType: court.gameType as any,
        playersRequired: getPlayersRequired(court.gameType as CourtGameType),
      },
      turns: court.turns.map((turn) => ({
        id: turn.id,
        courtId: turn.courtId,
        position: turn.position,
        status: turn.status as any,
        gameType: turn.gameType as any,
        createdById: turn.createdById,
        createdByName: turn.createdBy.name,
        players: turn.players.map((p) => ({
          id: p.id,
          userId: p.userId,
          userName: p.user.name,
        })),
        game: turn.game
          ? {
              id: turn.game.id,
              turnId: turn.game.turnId,
              courtId: turn.game.courtId,
              status: turn.game.status as any,
              players: turn.game.players.map((p) => ({
                id: p.id,
                userId: p.userId,
                userName: p.user.name,
              })),
              createdAt: turn.game.createdAt.toISOString(),
            }
          : null,
        clubSessionId: turn.clubSessionId ?? null,
        clubName: (turn as any).clubSession?.club?.name ?? null,
        createdAt: turn.createdAt.toISOString(),
        startedAt: turn.startedAt?.toISOString() ?? null,
        completedAt: turn.completedAt?.toISOString() ?? null,
        timeLimitAt: turn.timeLimitAt?.toISOString() ?? null,
      })),
      maxTurns,
      clubSessionInfo,
    };
  });
}

export async function getDisplayBoard(facilityId: string): Promise<DisplayBoardResponse> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      policy: true,
      courts: {
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
      },
      sessions: {
        where: { status: 'OPEN' },
        take: 1,
        orderBy: { openedAt: 'desc' },
      },
    },
  });
  if (!facility) throw new NotFoundError('시설');

  const currentSession = facility.sessions[0] || null;
  const maxTurns = facility.policy?.maxTurnsPerCourt ?? 3;

  const courts = facility.courts.map((court) => {
    const playingTurn = court.turns.find((t) => t.status === 'PLAYING');

    return {
      courtName: court.name,
      status: court.status as any,
      currentPlayers: playingTurn
        ? playingTurn.players.map((p) => p.user.name)
        : [],
      turnsCount: court.turns.length,
      maxTurns,
      timeLimitAt: playingTurn?.timeLimitAt?.toISOString() ?? null,
      turnPreviews: court.turns.map((t) => ({
        position: t.position,
        players: t.players.map((p) => p.user.name),
        status: t.status as any,
      })),
    };
  });

  return {
    facilityName: facility.name,
    sessionStatus: currentSession?.status as any ?? null,
    courts,
    updatedAt: new Date().toISOString(),
  };
}

// --- Facility Request ---

export async function createFacilityRequest(
  userId: string,
  input: { name: string; address: string },
): Promise<FacilityRequestResponse> {
  const request = await prisma.facilityRequest.create({
    data: {
      userId,
      name: input.name,
      address: input.address,
    },
    include: { user: true, reviewedBy: true },
  });

  return mapFacilityRequest(request);
}

export async function listFacilityRequests(status?: string) {
  const where = status ? { status: status as any } : {};
  const requests = await prisma.facilityRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { user: true, reviewedBy: true },
  });
  return requests.map(mapFacilityRequest);
}

export async function getMyFacilityRequests(userId: string) {
  const requests = await prisma.facilityRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { user: true, reviewedBy: true },
  });
  return requests.map(mapFacilityRequest);
}

export async function reviewFacilityRequest(
  requestId: string,
  reviewerId: string,
  approved: boolean,
  reviewNote?: string,
): Promise<FacilityRequestResponse> {
  const request = await prisma.facilityRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError('시설 등록 요청');
  if (request.status !== 'PENDING') {
    throw new Error('이미 처리된 요청입니다');
  }

  const updated = await prisma.facilityRequest.update({
    where: { id: requestId },
    data: {
      status: approved ? 'APPROVED' : 'REJECTED',
      reviewedById: reviewerId,
      reviewNote: reviewNote ?? null,
      reviewedAt: new Date(),
    },
    include: { user: true, reviewedBy: true },
  });

  return mapFacilityRequest(updated);
}

export async function getTodayStats(facilityId: string) {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { courts: { select: { id: true } } },
  });
  if (!facility) throw new NotFoundError('시설');

  const courtIds = facility.courts.map((c) => c.id);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Count completed games today
  const totalGames = await prisma.game.count({
    where: {
      courtId: { in: courtIds },
      status: 'COMPLETED',
      createdAt: { gte: startOfDay },
    },
  });

  // Average wait time from courtTurn records (startedAt - createdAt)
  const turnsWithWait = await prisma.courtTurn.findMany({
    where: {
      courtId: { in: courtIds },
      startedAt: { not: null, gte: startOfDay },
    },
    select: { createdAt: true, startedAt: true },
  });

  let avgWaitMinutes = 0;
  if (turnsWithWait.length > 0) {
    const totalWaitMs = turnsWithWait.reduce((sum, t) => {
      return sum + (t.startedAt!.getTime() - t.createdAt.getTime());
    }, 0);
    avgWaitMinutes = Math.round(totalWaitMs / turnsWithWait.length / 60000);
  }

  // Peak players: use current totalCheckedIn as a proxy
  const peakPlayers = await prisma.checkIn.count({
    where: {
      facilityId,
      checkedInAt: { gte: startOfDay },
    },
  });

  return { totalGames, avgWaitMinutes, peakPlayers };
}

function mapFacilityRequest(req: any): FacilityRequestResponse {
  return {
    id: req.id,
    userId: req.userId,
    userName: req.user.name,
    name: req.name,
    address: req.address,
    status: req.status,
    reviewNote: req.reviewNote,
    reviewedById: req.reviewedById,
    reviewedByName: req.reviewedBy?.name ?? null,
    createdAt: req.createdAt.toISOString(),
    reviewedAt: req.reviewedAt?.toISOString() ?? null,
  };
}
