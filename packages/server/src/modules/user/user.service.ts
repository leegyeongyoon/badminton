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
    // 취소된 게임(CANCELLED)의 GamePlayer 행은 삭제되지 않으므로, 상태로 걸러
    // 실제로 진행/완료된 게임만 센다(취소된 편성이 통계를 부풀리는 버그 방지).
    where: { userId, game: { status: { not: 'CANCELLED' } } },
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
    // 취소된 게임(CANCELLED)의 GamePlayer 행은 삭제되지 않으므로, 상태로 걸러
    // 실제로 진행/완료된 게임만 센다(취소된 편성이 통계를 부풀리는 버그 방지).
    where: { userId, game: { status: { not: 'CANCELLED' } } },
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
    // 취소된 게임(CANCELLED)의 GamePlayer 행은 삭제되지 않으므로, 상태로 걸러
    // 실제로 진행/완료된 게임만 센다(취소된 편성이 통계를 부풀리는 버그 방지).
    where: { userId, game: { status: { not: 'CANCELLED' } } },
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
      game: { createdAt: { gte: startOfDay }, status: { not: 'CANCELLED' } },
    },
  });

  // This month's games (since the 1st, local server time)
  const startOfMonth = new Date();
  startOfMonth.setHours(0, 0, 0, 0);
  startOfMonth.setDate(1);
  const gamesThisMonth = await prisma.gamePlayer.count({
    where: {
      userId,
      game: { createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
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
    gamesThisMonth,
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
  // The facility-LEVEL court include (clubSessionId=null) was retired with the
  // old facility-admin dashboard. Consumers only need id/name/address (e.g. the
  // /users/me/admin-facilities isAdmin check), so no court include is needed.
  const adminRecords = await prisma.facilityAdmin.findMany({
    where: { userId },
    include: { facility: true },
  });
  return adminRecords.map((a) => ({
    id: a.facility.id,
    name: a.facility.name,
    address: a.facility.address,
  }));
}

export async function getWeeklyStats(userId: string): Promise<{ day: string; count: number }[]> {
  const now = new Date();
  const results: { day: string; count: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const count = await prisma.gamePlayer.count({
      where: {
        userId,
        game: { createdAt: { gte: startOfDay, lte: endOfDay }, status: { not: 'CANCELLED' } },
      },
    });

    const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    results.push({ day: dayLabel, count });
  }

  return results;
}

export async function getGameTypeDistribution(
  userId: string,
): Promise<{ label: string; value: number; color: string }[]> {
  const gamePlayers = await prisma.gamePlayer.findMany({
    where: { userId, game: { status: { not: 'CANCELLED' } } },
    include: {
      game: {
        include: { turn: { select: { gameType: true } } },
      },
    },
  });

  const typeMap: Record<string, number> = {};
  for (const gp of gamePlayers) {
    const gt = gp.game.turn?.gameType ?? 'SINGLES';
    typeMap[gt] = (typeMap[gt] || 0) + 1;
  }

  const colorMap: Record<string, string> = {
    SINGLES: '#4A90D9',
    DOUBLES: '#50C878',
    MIXED_DOUBLES: '#FF6B6B',
  };

  const labelMap: Record<string, string> = {
    SINGLES: '단식',
    DOUBLES: '복식',
    MIXED_DOUBLES: '혼합복식',
    LESSON: '레슨',
  };

  return Object.entries(typeMap).map(([type, value]) => ({
    label: labelMap[type] || type,
    value,
    color: colorMap[type] || '#999999',
  }));
}

export async function getTotalStats(
  userId: string,
): Promise<{ totalGames: number; consecutiveDays: number }> {
  const totalGames = await prisma.gamePlayer.count({
    where: { userId, game: { status: { not: 'CANCELLED' } } },
  });

  // Calculate consecutive days ending today
  const now = new Date();
  let consecutiveDays = 0;

  for (let i = 0; i < 365; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const count = await prisma.gamePlayer.count({
      where: {
        userId,
        game: { createdAt: { gte: startOfDay, lte: endOfDay }, status: { not: 'CANCELLED' } },
      },
    });

    if (count > 0) {
      consecutiveDays++;
    } else if (i === 0) {
      // 오늘은 아직 안 쳤을 수 있으니, 오늘의 0은 연속 끊김으로 보지 않고 어제부터 이어센다.
      continue;
    } else {
      break;
    }
  }

  return { totalGames, consecutiveDays };
}

/** 이번 달 기록 카드 — 회원이 단톡·SNS에 자랑(공유)하는 월간 요약.
 *  출석일수(체크인한 날 distinct)·게임 수·연속 출석·누적 게임. KST 기준 월. */
export async function getMonthCard(userId: string): Promise<{
  yearMonth: string; // "YYYY-MM"
  attendanceDays: number;
  games: number;
  consecutiveDays: number;
  totalGames: number;
}> {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth(); // 0-based
  const yearMonth = `${y}-${String(m + 1).padStart(2, '0')}`;
  // KST 월초/말 → UTC 경계
  const monthStart = new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS);
  const monthEnd = new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS);

  const [games, checkins, totals] = await Promise.all([
    prisma.gamePlayer.count({
      where: { userId, game: { createdAt: { gte: monthStart, lt: monthEnd }, status: { not: 'CANCELLED' } } },
    }),
    prisma.checkIn.findMany({
      where: { userId, checkedInAt: { gte: monthStart, lt: monthEnd } },
      select: { checkedInAt: true },
    }),
    getTotalStats(userId),
  ]);
  const days = new Set(
    checkins.map((c) => new Date(c.checkedInAt.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)),
  );
  return {
    yearMonth,
    attendanceDays: days.size,
    games,
    consecutiveDays: totals.consecutiveDays,
    totalGames: totals.totalGames,
  };
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
