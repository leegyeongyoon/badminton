import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../utils/errors';
import { CourtStatus, GameStatus, CallStatus } from '@badminton/shared';
import { transitionCourtStatus } from '../court/court.service';
import { getIO } from '../../socket';
import { sendPushToUser } from '../notification/notification.service';
import { scheduleJob, registerJobHandler } from '../scheduler/scheduler.service';

export async function createGame(holdId: string, playerIds: string[], userId: string) {
  const hold = await prisma.courtHold.findUnique({
    where: { id: holdId },
    include: {
      games: true,
      court: { include: { facility: { include: { policy: true } } } },
    },
  });
  if (!hold) throw new NotFoundError('홀드');
  if (hold.status !== 'ACTIVE') throw new BadRequestError('활성 홀드가 아닙니다');

  // Check permission: must be club member
  const membership = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: hold.clubId } },
  });
  if (!membership) throw new ForbiddenError('해당 모임의 멤버가 아닙니다');

  // Enforce slotsPerCourt limit
  const slotsPerCourt = hold.court.facility.policy?.slotsPerCourt || 3;
  const activeGames = hold.games.filter(
    (g) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED',
  );
  if (activeGames.length >= slotsPerCourt) {
    throw new BadRequestError(`슬롯이 가득 찼습니다 (최대 ${slotsPerCourt})`);
  }

  const nextOrder = activeGames.length + 1;

  const game = await prisma.game.create({
    data: {
      holdId,
      order: nextOrder,
      players: {
        create: playerIds.map((pid) => ({ userId: pid })),
      },
    },
    include: { players: { include: { user: true } } },
  });

  const mapped = mapGame(game);
  const io = getIO();
  const court = await prisma.court.findUnique({ where: { id: hold.courtId } });
  if (court) {
    io.to(`court:${hold.courtId}`).emit('lineup:gameAdded', mapped);
    io.to(`facility:${court.facilityId}`).emit('lineup:gameAdded', mapped);
  }

  return mapped;
}

export async function getLineup(holdId: string) {
  const games = await prisma.game.findMany({
    where: { holdId },
    orderBy: { order: 'asc' },
    include: { players: { include: { user: true } } },
  });
  return games.map(mapGame);
}

export async function callGame(gameId: string, userId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: { include: { user: true } },
      hold: { include: { court: { include: { facility: { include: { policy: true } } } } } },
    },
  });
  if (!game) throw new NotFoundError('게임');
  if (game.status !== 'WAITING') throw new BadRequestError('대기 상태의 게임만 호출할 수 있습니다');

  // Check permission
  const membership = await prisma.clubMember.findUnique({
    where: { userId_clubId: { userId, clubId: game.hold.clubId } },
  });
  if (!membership) throw new ForbiddenError('해당 모임의 멤버가 아닙니다');

  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'CALLING' },
  });

  // Send push to all players
  const courtName = game.hold.court.name;
  for (const player of game.players) {
    await sendPushToUser(player.userId, {
      title: '게임 호출',
      body: `${courtName}에서 게임이 호출되었습니다. 응답해주세요!`,
      data: { gameId, type: 'game_call' },
    });

    const io = getIO();
    io.to(`user:${player.userId}`).emit('notification:call', {
      gameId,
      courtName,
      message: `${courtName}에서 게임이 호출되었습니다`,
    });
  }

  // Schedule persistent timeout for call
  const timeout = game.hold.court.facility.policy?.callTimeoutSeconds || 120;
  const callDeadline = new Date(Date.now() + timeout * 1000);
  await scheduleJob('GAME_CALL_TIMEOUT', gameId, callDeadline);

  const updated = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } } },
  });
  const mapped = mapGame(updated!);

  const io = getIO();
  io.to(`court:${game.hold.courtId}`).emit('game:calling', mapped);

  return mapped;
}

export async function respondToCall(gameId: string, userId: string, accept: boolean) {
  const player = await prisma.gamePlayer.findFirst({
    where: { gameId, userId },
  });
  if (!player) throw new NotFoundError('게임 플레이어');

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new NotFoundError('게임');
  if (game.status !== 'CALLING') throw new BadRequestError('호출 중인 게임만 응답할 수 있습니다');

  const newStatus = accept ? CallStatus.ACCEPTED : CallStatus.DECLINED;
  await prisma.gamePlayer.update({
    where: { id: player.id },
    data: { callStatus: newStatus },
  });

  const io = getIO();
  const hold = await prisma.courtHold.findUnique({ where: { id: game.holdId } });
  io.to(`court:${hold?.courtId}`).emit('game:playerResponded', {
    gameId,
    playerId: userId,
    callStatus: newStatus,
  });

  // Check if all accepted
  const allPlayers = await prisma.gamePlayer.findMany({ where: { gameId } });
  const allAccepted = allPlayers.every((p) => p.callStatus === 'ACCEPTED');
  if (allAccepted) {
    await prisma.game.update({
      where: { id: gameId },
      data: { status: 'CONFIRMED' },
    });
    const confirmed = await prisma.game.findUnique({
      where: { id: gameId },
      include: { players: { include: { user: true } } },
    });
    io.to(`court:${hold?.courtId}`).emit('game:confirmed', mapGame(confirmed!));
  }

  return { success: true };
}

export async function startGame(gameId: string, userId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { hold: true },
  });
  if (!game) throw new NotFoundError('게임');
  if (game.status !== 'CONFIRMED') throw new BadRequestError('확정된 게임만 시작할 수 있습니다');

  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'IN_PROGRESS' },
  });

  await transitionCourtStatus(game.hold.courtId, CourtStatus.IN_GAME);

  const updated = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } } },
  });
  const mapped = mapGame(updated!);

  const io = getIO();
  const court = await prisma.court.findUnique({ where: { id: game.hold.courtId } });
  io.to(`court:${game.hold.courtId}`).emit('game:started', mapped);
  if (court) {
    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId: game.hold.courtId,
      status: CourtStatus.IN_GAME,
    });
  }

  return mapped;
}

export async function completeGame(gameId: string, userId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { hold: true },
  });
  if (!game) throw new NotFoundError('게임');
  if (game.status !== 'IN_PROGRESS') throw new BadRequestError('진행 중인 게임만 종료할 수 있습니다');

  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'COMPLETED' },
  });

  // Promote remaining games: shift orders down (slot promotion)
  const remainingGames = await prisma.game.findMany({
    where: {
      holdId: game.holdId,
      status: { in: ['WAITING', 'CALLING', 'CONFIRMED', 'IN_PROGRESS'] },
    },
    orderBy: { order: 'asc' },
  });
  for (let i = 0; i < remainingGames.length; i++) {
    if (remainingGames[i].order !== i + 1) {
      await prisma.game.update({
        where: { id: remainingGames[i].id },
        data: { order: i + 1 },
      });
    }
  }

  if (game.hold.status !== 'ACTIVE') {
    await transitionCourtStatus(game.hold.courtId, CourtStatus.EMPTY);
  } else {
    await transitionCourtStatus(game.hold.courtId, CourtStatus.HELD);
  }

  const updated = await prisma.game.findUnique({
    where: { id: gameId },
    include: { players: { include: { user: true } } },
  });
  const mapped = mapGame(updated!);

  const io = getIO();
  const court = await prisma.court.findUnique({ where: { id: game.hold.courtId } });
  io.to(`court:${game.hold.courtId}`).emit('game:completed', mapped);
  if (court) {
    io.to(`facility:${court.facilityId}`).emit('court:statusChanged', {
      courtId: game.hold.courtId,
      status: game.hold.status === 'ACTIVE' ? CourtStatus.HELD : CourtStatus.EMPTY,
    });
  }

  return mapped;
}

export async function replacePlayer(gameId: string, targetPlayerId: string, replacementPlayerId: string, userId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { hold: true },
  });
  if (!game) throw new NotFoundError('게임');
  if (game.status !== 'CALLING' && game.status !== 'WAITING') {
    throw new BadRequestError('대기 또는 호출 중인 게임만 교체할 수 있습니다');
  }

  const targetPlayer = await prisma.gamePlayer.findFirst({
    where: { gameId, userId: targetPlayerId },
  });
  if (!targetPlayer) throw new NotFoundError('교체 대상 플레이어');

  await prisma.gamePlayer.update({
    where: { id: targetPlayer.id },
    data: { userId: replacementPlayerId, callStatus: 'PENDING' },
  });

  const io = getIO();
  io.to(`court:${game.hold.courtId}`).emit('game:playerReplaced', {
    gameId,
    oldPlayerId: targetPlayerId,
    newPlayerId: replacementPlayerId,
  });

  return { success: true };
}

export async function handleCallTimeout(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      players: true,
      hold: { include: { court: { include: { facility: { include: { policy: true } } } } } },
    },
  });
  if (!game || game.status !== 'CALLING') return;

  const facilityId = game.hold.court.facilityId;
  const penaltyMinutes = game.hold.court.facility.policy?.noShowPenaltyMinutes || 30;

  // Mark pending players as NO_SHOW and create penalty records
  const pendingPlayers = game.players.filter((p) => p.callStatus === 'PENDING');
  for (const p of pendingPlayers) {
    await prisma.gamePlayer.update({
      where: { id: p.id },
      data: { callStatus: 'NO_SHOW' },
    });

    // Create NoShowRecord with penalty
    await prisma.noShowRecord.create({
      data: {
        userId: p.userId,
        gameId,
        facilityId,
        penaltyEndsAt: new Date(Date.now() + penaltyMinutes * 60 * 1000),
      },
    });
  }

  // Count DECLINED from original snapshot + newly marked NO_SHOW (pendingPlayers)
  const declinedCount = game.players.filter(
    (p) => p.callStatus === 'DECLINED',
  ).length;
  const noShowCount = declinedCount + pendingPlayers.length;

  const maxNoShows = game.hold.court.facility.policy?.maxNoShowsBeforeCancel || 2;
  if (noShowCount >= maxNoShows) {
    await prisma.game.update({
      where: { id: gameId },
      data: { status: 'CANCELLED' },
    });
  }
  // Otherwise leader can replace and re-call
}

// Register scheduler handler
registerJobHandler('GAME_CALL_TIMEOUT', async (gameId: string) => {
  await handleCallTimeout(gameId);
});

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
