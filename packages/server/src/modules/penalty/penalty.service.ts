import { prisma } from '../../utils/prisma';
import type { NoShowRecordResponse } from '@badminton/shared';
import { logger } from '../../utils/logger';

export async function getFacilityPenalties(facilityId: string): Promise<NoShowRecordResponse[]> {
  const records = await prisma.noShowRecord.findMany({
    where: { facilityId },
    orderBy: { occurredAt: 'desc' },
    include: { user: true },
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

export async function createNoShowRecord(
  userId: string,
  gameId: string,
  facilityId: string,
  penaltyMinutes: number,
): Promise<NoShowRecordResponse> {
  const penaltyEndsAt = penaltyMinutes > 0
    ? new Date(Date.now() + penaltyMinutes * 60 * 1000)
    : null;

  const record = await prisma.noShowRecord.create({
    data: {
      userId,
      gameId,
      facilityId,
      penaltyEndsAt,
    },
  });

  logger.info(
    `No-show recorded for user ${userId} in game ${gameId} at facility ${facilityId}, penalty ends at ${penaltyEndsAt?.toISOString() ?? 'N/A'}`,
  );

  return {
    id: record.id,
    userId: record.userId,
    gameId: record.gameId,
    facilityId: record.facilityId,
    occurredAt: record.occurredAt.toISOString(),
    penaltyEndsAt: record.penaltyEndsAt?.toISOString() ?? null,
  };
}

export async function hasActivePenalty(userId: string, facilityId: string): Promise<boolean> {
  const now = new Date();
  const activePenalty = await prisma.noShowRecord.findFirst({
    where: {
      userId,
      facilityId,
      penaltyEndsAt: { gt: now },
    },
  });

  return !!activePenalty;
}
