import { prisma } from '../../utils/prisma';
import type {
  PlayerProfileResponse,
  PlayerStatsResponse,
  GameHistoryResponse,
  NoShowRecordResponse,
} from '@badminton/shared';

export async function getProfile(userId: string): Promise<PlayerProfileResponse> {
  let profile = await prisma.playerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    profile = await prisma.playerProfile.create({
      data: { userId },
    });
  }

  const gamesPlayed = await prisma.gamePlayer.count({
    where: { userId },
  });

  const noShowCount = await prisma.noShowRecord.count({
    where: { userId },
  });

  return {
    userId: profile.userId,
    skillLevel: profile.skillLevel as any,
    preferredGameTypes: profile.preferredGameTypes as any,
    gender: profile.gender,
    birthYear: profile.birthYear,
    gamesPlayed,
    noShowCount,
  };
}

export async function updateProfile(
  userId: string,
  data: { skillLevel?: string; preferredGameTypes?: string[]; gender?: string | null; birthYear?: number | null },
): Promise<PlayerProfileResponse> {
  const profile = await prisma.playerProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...(data.skillLevel && { skillLevel: data.skillLevel as any }),
      ...(data.preferredGameTypes && { preferredGameTypes: data.preferredGameTypes as any }),
      ...(data.gender !== undefined && { gender: data.gender }),
      ...(data.birthYear !== undefined && { birthYear: data.birthYear }),
    },
    update: {
      ...(data.skillLevel && { skillLevel: data.skillLevel as any }),
      ...(data.preferredGameTypes && { preferredGameTypes: data.preferredGameTypes as any }),
      ...(data.gender !== undefined && { gender: data.gender }),
      ...(data.birthYear !== undefined && { birthYear: data.birthYear }),
    },
  });

  const gamesPlayed = await prisma.gamePlayer.count({
    where: { userId },
  });

  const noShowCount = await prisma.noShowRecord.count({
    where: { userId },
  });

  return {
    userId: profile.userId,
    skillLevel: profile.skillLevel as any,
    preferredGameTypes: profile.preferredGameTypes as any,
    gender: profile.gender,
    birthYear: profile.birthYear,
    gamesPlayed,
    noShowCount,
  };
}

export async function getStats(userId: string): Promise<PlayerStatsResponse> {
  const gamesPlayed = await prisma.gamePlayer.count({
    where: { userId },
  });

  const gamesCompleted = await prisma.gamePlayer.count({
    where: {
      userId,
      game: { status: 'COMPLETED' },
    },
  });

  // Today's games
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const gamesPlayedToday = await prisma.gamePlayer.count({
    where: {
      userId,
      game: { createdAt: { gte: startOfDay } },
    },
  });

  const noShowCount = await prisma.noShowRecord.count({
    where: { userId },
  });

  const now = new Date();
  const activePenalty = await prisma.noShowRecord.findFirst({
    where: {
      userId,
      penaltyEndsAt: { gt: now },
    },
    orderBy: { penaltyEndsAt: 'desc' },
  });

  return {
    gamesPlayed,
    gamesCompleted,
    gamesPlayedToday,
    noShowCount,
    activePenalty: activePenalty
      ? {
          id: activePenalty.id,
          userId: activePenalty.userId,
          gameId: activePenalty.gameId,
          facilityId: activePenalty.facilityId,
          occurredAt: activePenalty.occurredAt.toISOString(),
          penaltyEndsAt: activePenalty.penaltyEndsAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function getHistory(
  userId: string,
  page: number = 1,
  limit: number = 20,
): Promise<GameHistoryResponse[]> {
  const skip = (page - 1) * limit;

  const gamePlayers = await prisma.gamePlayer.findMany({
    where: { userId },
    skip,
    take: limit,
    orderBy: { game: { createdAt: 'desc' } },
    include: {
      game: {
        include: {
          court: true,
          players: {
            include: { user: true },
          },
        },
      },
    },
  });

  return gamePlayers.map((gp) => ({
    gameId: gp.game.id,
    courtName: gp.game.court.name,
    status: gp.game.status as any,
    players: gp.game.players.map((p) => p.user.name),
    playedAt: gp.game.createdAt.toISOString(),
  }));
}

export async function getAdminFacilities(userId: string) {
  const adminRecords = await prisma.facilityAdmin.findMany({
    where: { userId },
    include: { facility: { include: { courts: true } } },
  });
  return adminRecords.map((a) => ({
    id: a.facility.id,
    name: a.facility.name,
    address: a.facility.address,
    courtCount: a.facility.courts.length,
  }));
}

export async function getPenalties(userId: string): Promise<NoShowRecordResponse[]> {
  const records = await prisma.noShowRecord.findMany({
    where: { userId },
    orderBy: { occurredAt: 'desc' },
  });

  return records.map((r) => ({
    id: r.id,
    userId: r.userId,
    gameId: r.gameId,
    facilityId: r.facilityId,
    occurredAt: r.occurredAt.toISOString(),
    penaltyEndsAt: r.penaltyEndsAt?.toISOString() ?? null,
  }));
}
