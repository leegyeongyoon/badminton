/**
 * 운영진 편성 요청 — "철수·영희 대회 파트너라 2게임 같이", "민수·지훈은 같이 안 짜기", "이 4명 같이 한 판".
 * 자동 편성 엔진(suggestNextFoursome)이 지킨다. 정모 단위, 운영진(대표/운영진)만 관리.
 *  · TOGETHER: 같은 팀(파트너)으로. games = 같이 칠 판수(null = 정모 내내). 채우면 자동 종료(표시만 '완료').
 *  · APART:    같은 게임에 넣지 않음(상대편으로도 X).
 *  · GAME:     지정한 4명(memberIds)을 같이 한 판(games 판, 기본 1). 운영진 '예외' 요청 — 급수 규칙 예외이고
 *              모임 스타일 학습에서도 뺀다(평소 기준이 아니라 그 자리 사정: "빡세게 넣어 달라" 같은 구두 요청).
 */
import { prisma } from '../../utils/prisma';
import { NotFoundError, BadRequestError } from '../../utils/errors';
import { getIO } from '../../socket';
import { verifyClubStaff } from '../clubSession/clubSession.service';

export type RequestKind = 'TOGETHER' | 'APART' | 'GAME';

export interface SessionRequestView {
  id: string;
  kind: RequestKind;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** GAME: 지정한 4명(이름 순서 = memberIds 순서). 다른 종류는 빈 배열. */
  memberIds: string[];
  memberNames: string[];
  games: number | null;
  /** 이번 정모에서 실제로 같은 게임에 들어간 판수(코트 시작된 판 기준). GAME 은 4명이 모두 든 판. */
  playedTogether: number;
  /** TOGETHER·GAME: 남은 판수(null=계속), 0이면 완료. APART: null. */
  remaining: number | null;
  note: string | null;
  createdAt: string;
}

const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const gk = (ids: string[]) => [...ids].sort().join('|');
const kindOf = (k: string): RequestKind => (k === 'APART' ? 'APART' : k === 'GAME' ? 'GAME' : 'TOGETHER');

/** 이번 정모에서 두 사람이 같은 게임(코트 시작된 판)에 들어간 횟수 + 4명 묶음이 같이 든 횟수(groups). */
export async function togetherCounts(clubSessionId: string): Promise<Map<string, number>> {
  const turns = await prisma.courtTurn.findMany({
    where: { clubSessionId, startedAt: { not: null }, status: { not: 'CANCELLED' } },
    select: { players: { select: { userId: true } } },
  });
  const m = new Map<string, number>();
  for (const t of turns) {
    const ids = t.players.map((p) => p.userId);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = pk(ids[i], ids[j]);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    if (ids.length === 4) {
      const k = gk(ids);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

const playedOf = (counts: Map<string, number>, r: { kind: string; aId: string; bId: string; memberIds: string[] }) =>
  r.kind === 'GAME' && r.memberIds.length === 4 ? (counts.get(gk(r.memberIds)) ?? 0) : (counts.get(pk(r.aId, r.bId)) ?? 0);

async function sessionOrThrow(clubSessionId: string) {
  const s = await prisma.clubSession.findUnique({
    where: { id: clubSessionId },
    select: { id: true, clubId: true, facilityId: true },
  });
  if (!s) throw new NotFoundError('모임 세션');
  return s;
}

function broadcast(facilityId: string, clubSessionId: string) {
  try {
    getIO().to(`facility:${facilityId}`).emit('clubSession:requestsUpdated', { clubSessionId });
  } catch {
    /* 소켓 미연결 — 다음 조회에서 최신값 */
  }
}

export async function listRequests(clubSessionId: string, userId: string): Promise<SessionRequestView[]> {
  const s = await sessionOrThrow(clubSessionId);
  await verifyClubStaff(s.clubId, userId);
  const rows = await prisma.sessionRequest.findMany({ where: { clubSessionId }, orderBy: { createdAt: 'asc' } });
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.aId, r.bId, ...r.memberIds])));
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const counts = await togetherCounts(clubSessionId);
  return rows.map((r) => {
    const played = playedOf(counts, r);
    const kind = kindOf(r.kind);
    return {
      id: r.id,
      kind,
      aId: r.aId,
      bId: r.bId,
      aName: names.get(r.aId) ?? '?',
      bName: names.get(r.bId) ?? '?',
      memberIds: kind === 'GAME' ? r.memberIds : [],
      memberNames: kind === 'GAME' ? r.memberIds.map((id) => names.get(id) ?? '?') : [],
      games: r.games,
      playedTogether: played,
      remaining: kind !== 'APART' && r.games != null ? Math.max(0, r.games - played) : null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function createRequest(
  clubSessionId: string,
  userId: string,
  input: { kind: RequestKind; aId: string; bId: string; memberIds?: string[]; games?: number | null; note?: string | null },
) {
  const s = await sessionOrThrow(clubSessionId);
  await verifyClubStaff(s.clubId, userId);
  if (input.kind === 'GAME') {
    const members = Array.from(new Set(input.memberIds ?? []));
    if (members.length !== 4) throw new BadRequestError('서로 다른 네 사람을 골라 주세요');
    const users = await prisma.user.count({ where: { id: { in: members } } });
    if (users !== 4) throw new NotFoundError('선수');
    // 같은 4명에 대한 기존 요청은 교체. 판수는 '지금부터 N판 더'(이미 같이 친 판수에 더해 누적치로 저장).
    const existing = await prisma.sessionRequest.findMany({ where: { clubSessionId, kind: 'GAME' }, select: { id: true, memberIds: true } });
    const dup = existing.filter((e) => gk(e.memberIds) === gk(members)).map((e) => e.id);
    if (dup.length) await prisma.sessionRequest.deleteMany({ where: { id: { in: dup } } });
    const already = (await togetherCounts(clubSessionId)).get(gk(members)) ?? 0;
    await prisma.sessionRequest.create({
      data: {
        clubSessionId,
        kind: 'GAME',
        aId: members[0],
        bId: members[1],
        memberIds: members,
        games: already + (input.games ?? 1),
        note: input.note?.slice(0, 100) ?? null,
        createdById: userId,
      },
    });
    broadcast(s.facilityId, clubSessionId);
    return listRequests(clubSessionId, userId);
  }
  if (input.aId === input.bId) throw new BadRequestError('서로 다른 두 사람을 골라 주세요');
  const users = await prisma.user.count({ where: { id: { in: [input.aId, input.bId] } } });
  if (users !== 2) throw new NotFoundError('선수');
  // 같은 두 사람에 대한 기존 요청은 새 요청으로 교체(파트너 ↔ 떼기 전환 포함).
  await prisma.sessionRequest.deleteMany({
    where: {
      clubSessionId,
      kind: { in: ['TOGETHER', 'APART'] },
      OR: [
        { aId: input.aId, bId: input.bId },
        { aId: input.bId, bId: input.aId },
      ],
    },
  });
  // TOGETHER 판수는 '지금부터 N판 더' 의미 — 이미 같이 친 판수를 더해 저장(목표 누적치).
  let games: number | null = null;
  if (input.kind === 'TOGETHER' && input.games != null) {
    const already = (await togetherCounts(clubSessionId)).get(pk(input.aId, input.bId)) ?? 0;
    games = already + input.games;
  }
  await prisma.sessionRequest.create({
    data: {
      clubSessionId,
      kind: input.kind,
      aId: input.aId,
      bId: input.bId,
      games,
      note: input.note?.slice(0, 100) ?? null,
      createdById: userId,
    },
  });
  broadcast(s.facilityId, clubSessionId);
  return listRequests(clubSessionId, userId);
}

export async function deleteRequest(clubSessionId: string, requestId: string, userId: string) {
  const s = await sessionOrThrow(clubSessionId);
  await verifyClubStaff(s.clubId, userId);
  await prisma.sessionRequest.deleteMany({ where: { id: requestId, clubSessionId } });
  broadcast(s.facilityId, clubSessionId);
  return listRequests(clubSessionId, userId);
}

/** 엔진용 — 지금 유효한 요청(완료된 TOGETHER·GAME 제외는 엔진이 played·games 로 판단). */
export async function activeRequestsForEngine(clubSessionId: string) {
  const rows = await prisma.sessionRequest.findMany({ where: { clubSessionId } });
  const counts = await togetherCounts(clubSessionId);
  return rows.map((r) => ({
    kind: kindOf(r.kind),
    aId: r.aId,
    bId: r.bId,
    memberIds: r.kind === 'GAME' ? r.memberIds : [],
    games: r.games,
    played: playedOf(counts, r),
  }));
}
