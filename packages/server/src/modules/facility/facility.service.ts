import { prisma } from '../../utils/prisma';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import type { CreateFacilityInput, UpdatePolicyInput, DisplayBoardResponse } from '@badminton/shared';
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
  return prisma.facility.findMany({
    include: { courts: true },
    orderBy: { createdAt: 'desc' },
  });
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

export async function getBoard(facilityId: string) {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      policy: true,
      courts: {
        orderBy: { name: 'asc' },
        include: {
          holds: {
            where: { status: { in: ['ACTIVE', 'QUEUED', 'PENDING_ACCEPT'] } },
            orderBy: { queuePosition: 'asc' },
            include: {
              club: true,
              createdBy: true,
              games: {
                orderBy: { order: 'asc' },
                include: {
                  players: { include: { user: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!facility) throw new NotFoundError('시설');

  const slotsTotal = facility.policy?.slotsPerCourt || 3;

  return facility.courts.map((court) => {
    const activeHold = court.holds.find((h) => h.status === 'ACTIVE') || null;
    const queueHolds = court.holds.filter((h) => h.status === 'QUEUED' || h.status === 'PENDING_ACCEPT');
    const games = activeHold?.games || [];
    const currentGame = games.find((g) => g.status === 'IN_PROGRESS' || g.status === 'CALLING' || g.status === 'CONFIRMED') || null;
    const upcomingGames = games.filter((g) => g.status === 'WAITING');
    const activeGameCount = games.filter((g) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED').length;

    return {
      court: { id: court.id, name: court.name, facilityId: court.facilityId, status: court.status },
      currentGame: currentGame ? mapGame(currentGame) : null,
      upcomingGames: upcomingGames.map(mapGame),
      holdClubName: activeHold?.club.name || null,
      holdClubId: activeHold?.clubId || null,
      queueCount: queueHolds.length,
      slotsUsed: activeGameCount,
      slotsTotal,
    };
  });
}

export async function getDisplayBoard(facilityId: string): Promise<DisplayBoardResponse> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: {
      courts: {
        orderBy: { name: 'asc' },
        include: {
          holds: {
            where: { status: { in: ['ACTIVE', 'QUEUED', 'PENDING_ACCEPT'] } },
            orderBy: { queuePosition: 'asc' },
            include: {
              club: true,
              createdBy: true,
              games: {
                orderBy: { order: 'asc' },
                include: {
                  players: { include: { user: true } },
                },
              },
            },
          },
          queueEntries: {
            where: { status: 'WAITING' },
            orderBy: { position: 'asc' },
            include: { user: true, club: true },
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

  const courts = facility.courts.map((court) => {
    const activeHold = court.holds.find((h) => h.status === 'ACTIVE') || null;
    const games = activeHold?.games || [];
    const currentGame = games.find(
      (g) => g.status === 'IN_PROGRESS' || g.status === 'CALLING' || g.status === 'CONFIRMED',
    ) || null;

    // Determine holder name: club name or individual user name
    let holderName: string | null = null;
    let holdType: string | null = null;
    if (activeHold) {
      holdType = activeHold.holdType;
      if (activeHold.club) {
        holderName = activeHold.club.name;
      } else {
        holderName = activeHold.createdBy.name;
      }
    }

    // Queue count from both legacy holds queue and new QueueEntry
    const legacyQueueCount = court.holds.filter(
      (h) => h.status === 'QUEUED' || h.status === 'PENDING_ACCEPT',
    ).length;
    const entryQueueCount = court.queueEntries.length;
    const queueCount = legacyQueueCount + entryQueueCount;

    // Queue preview: first 3 names from queue entries, then legacy queue holds
    const queuePreview: string[] = [];
    for (const entry of court.queueEntries) {
      if (queuePreview.length >= 3) break;
      queuePreview.push(entry.club?.name ?? entry.user.name);
    }
    if (queuePreview.length < 3) {
      const queueHolds = court.holds.filter(
        (h) => h.status === 'QUEUED' || h.status === 'PENDING_ACCEPT',
      );
      for (const hold of queueHolds) {
        if (queuePreview.length >= 3) break;
        queuePreview.push(hold.club?.name ?? hold.createdBy.name);
      }
    }

    return {
      courtName: court.name,
      status: court.status,
      holdType: holdType as any,
      holderName,
      currentGameStatus: currentGame?.status as any ?? null,
      currentPlayers: currentGame
        ? currentGame.players.map((p: any) => p.user.name)
        : [],
      queueCount,
      queuePreview,
    };
  });

  return {
    facilityName: facility.name,
    sessionStatus: currentSession?.status as any ?? null,
    courts,
    updatedAt: new Date().toISOString(),
  };
}

function mapGame(game: any) {
  return {
    id: game.id,
    holdId: game.holdId,
    order: game.order,
    status: game.status,
    players: game.players.map((p: any) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name,
      callStatus: p.callStatus,
    })),
    createdAt: game.createdAt.toISOString(),
  };
}
