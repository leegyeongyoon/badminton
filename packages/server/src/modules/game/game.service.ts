import { prisma } from '../../utils/prisma';
import type { GameHistoryResponse } from '@badminton/shared';

export async function getGameHistory(
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
