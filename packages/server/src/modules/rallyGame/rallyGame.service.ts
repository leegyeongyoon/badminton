/**
 * 콕고 랠리 PvP — 대결 신청/수락/거절 (REST 진입점).
 * 소켓은 무인증이므로 신원이 필요한 흐름은 전부 여기(authenticate 뒤)에서 시작하고,
 * 소켓 릴레이는 matchId + 멤버 대조로만 허용한다.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../utils/prisma';
import { getIO } from '../../socket';
import { logger } from '../../utils/logger';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { getMyStatus } from '../clubSession/clubSession.service';
import { sendPushToUser } from '../notification/notification.service';
import {
  RallyMatch,
  deleteRallyMatch,
  findRallyMatchByUser,
  getRallyMatch,
  putRallyMatch,
} from './rallyGame.store';

const PENDING_TTL_MS = 60_000;

/** 같은 정모에 체크인한 상대에게 대결 신청 */
export async function challenge(hostId: string, toUserId: string) {
  if (hostId === toUserId) throw new BadRequestError('자기 자신에게는 신청할 수 없어요');

  const [hostStatus, guestStatus] = await Promise.all([getMyStatus(hostId), getMyStatus(toUserId)]);
  if (!hostStatus?.clubSessionId) throw new BadRequestError('정모에 체크인한 상태에서만 신청할 수 있어요');
  if (!guestStatus?.clubSessionId || guestStatus.clubSessionId !== hostStatus.clubSessionId) {
    throw new BadRequestError('상대가 같은 정모에 체크인해 있지 않아요');
  }
  if (findRallyMatchByUser(hostId) || findRallyMatchByUser(toUserId)) {
    throw new ConflictError('이미 진행 중인 대결이 있어요');
  }

  const host = await prisma.user.findUnique({ where: { id: hostId }, select: { name: true } });
  const match: RallyMatch = {
    id: randomUUID(),
    clubSessionId: hostStatus.clubSessionId,
    hostId,
    hostName: host?.name ?? '상대',
    guestId: toUserId,
    state: 'PENDING',
    createdAt: Date.now(),
  };
  putRallyMatch(match);

  // 60초 내 미수락 시 만료
  setTimeout(() => {
    const m = getRallyMatch(match.id);
    if (m && m.state === 'PENDING') {
      deleteRallyMatch(match.id);
      getIO().to(`user:${m.hostId}`).emit('rally:declined', { matchId: m.id });
    }
  }, PENDING_TTL_MS);

  getIO().to(`user:${toUserId}`).emit('rally:invited', {
    matchId: match.id,
    from: { id: hostId, name: match.hostName },
  });
  // 앱이 백그라운드여도 도달하도록 푸시 병행 (실패해도 무시)
  sendPushToUser(toUserId, {
    title: '콕고 랠리 대결 신청 🏸',
    body: `${match.hostName}님이 미니게임 대결을 신청했어요`,
    data: { type: 'rally:invited', matchId: match.id },
  }).catch(() => {});

  logger.info(`rally challenge: ${hostId} -> ${toUserId} (${match.id})`);
  return { matchId: match.id };
}

export async function accept(matchId: string, userId: string) {
  const m = getRallyMatch(matchId);
  if (!m) throw new NotFoundError('만료됐거나 없는 대결이에요');
  if (m.guestId !== userId) throw new ForbiddenError('이 대결의 상대가 아니에요');
  if (m.state !== 'PENDING') throw new ConflictError('이미 시작된 대결이에요');
  m.state = 'ACTIVE';
  getIO().to(`user:${m.hostId}`).emit('rally:matched', { matchId });
  getIO().to(`user:${m.guestId}`).emit('rally:matched', { matchId });
  return { matchId, hostId: m.hostId, guestId: m.guestId };
}

export async function decline(matchId: string, userId: string) {
  const m = getRallyMatch(matchId);
  if (!m) return { ok: true }; // 이미 만료 — 조용히 성공
  if (m.guestId !== userId && m.hostId !== userId) throw new ForbiddenError('이 대결의 멤버가 아니에요');
  deleteRallyMatch(matchId);
  getIO().to(`user:${m.hostId}`).emit('rally:declined', { matchId });
  return { ok: true };
}

/** 소켓 disconnect/leave에서 호출 — 상대에게 통지 후 정리 */
export function leaveMatch(matchId: string, userId: string) {
  const m = getRallyMatch(matchId);
  if (!m || (m.hostId !== userId && m.guestId !== userId)) return;
  deleteRallyMatch(matchId);
  const other = m.hostId === userId ? m.guestId : m.hostId;
  getIO().to(`user:${other}`).emit('rally:opponentLeft', { matchId });
}

// ─── 재접속 유예 — 순간 끊김(백그라운드 전환·리로드)으로 매치가 즉사하지 않게 ───
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>(); // `${matchId}:${userId}`

export function scheduleLeave(matchId: string, userId: string, graceMs = 20_000) {
  const key = `${matchId}:${userId}`;
  if (pendingLeaves.has(key)) return;
  pendingLeaves.set(
    key,
    setTimeout(() => {
      pendingLeaves.delete(key);
      leaveMatch(matchId, userId);
    }, graceMs),
  );
}

export function cancelLeave(matchId: string, userId: string) {
  const key = `${matchId}:${userId}`;
  const t = pendingLeaves.get(key);
  if (t) {
    clearTimeout(t);
    pendingLeaves.delete(key);
  }
}

/** 호스트가 게임 종료 시 결과 보고 — 정모별 랠리왕 리더보드의 재료 */
export async function reportResult(
  matchId: string,
  reporterId: string,
  body: { hostScore: number; guestScore: number; longestRally: number },
) {
  const m = getRallyMatch(matchId);
  if (!m) throw new NotFoundError('만료됐거나 없는 대결이에요');
  if (m.hostId !== reporterId) throw new ForbiddenError('호스트만 결과를 보고할 수 있어요');
  if (m.state !== 'ACTIVE') throw new ConflictError('시작되지 않은 대결이에요');
  const hostScore = Math.max(0, Math.min(99, Math.floor(body.hostScore)));
  const guestScore = Math.max(0, Math.min(99, Math.floor(body.guestScore)));
  const winnerId = hostScore >= guestScore ? m.hostId : m.guestId;
  const row = await prisma.rallyResult.create({
    data: {
      clubSessionId: m.clubSessionId,
      hostId: m.hostId,
      guestId: m.guestId,
      hostScore,
      guestScore,
      winnerId,
      longestRally: Math.max(0, Math.min(999, Math.floor(body.longestRally ?? 0))),
    },
  });
  logger.info(`rally result: ${m.hostId} ${hostScore}:${guestScore} ${m.guestId} (${matchId})`);
  return { id: row.id };
}

/** 정모별 랠리왕 리더보드 — 승수 순 + 최장 랠리 */
export async function leaderboard(clubSessionId: string) {
  const rows = await prisma.rallyResult.findMany({
    where: { clubSessionId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const stat = new Map<string, { wins: number; losses: number }>();
  let longest: { userId: string; len: number } | null = null;
  for (const r of rows) {
    const loserId = r.winnerId === r.hostId ? r.guestId : r.hostId;
    const w = stat.get(r.winnerId) ?? { wins: 0, losses: 0 };
    w.wins += 1;
    stat.set(r.winnerId, w);
    const l = stat.get(loserId) ?? { wins: 0, losses: 0 };
    l.losses += 1;
    stat.set(loserId, l);
    if (r.longestRally > (longest?.len ?? 0)) longest = { userId: r.winnerId, len: r.longestRally };
  }
  const ids = [...stat.keys()];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '?';
  const kings = ids
    .map((id) => ({ userId: id, name: nameOf(id), ...stat.get(id)! }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    .slice(0, 10);
  return {
    games: rows.length,
    kings,
    longestRally: longest ? { ...longest, name: nameOf(longest.userId) } : null,
  };
}
