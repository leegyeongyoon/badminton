import { prisma } from '../../utils/prisma';

// ─── 승패로 본 실제 실력(팀 Elo) ───
// 운영진이 코트 종료 때 선택으로 누른 '이긴 두 사람'(CourtTurn.winnerIds)만 쓴다. 시작점은 급수 라벨
// (1500 + 단계×100)이라, 결과가 쌓인 뒤 남는 차이(residual)는 '라벨보다 잘/못 하는 정도'다.
//  · 팀 나누기: 같은 급수 안에서 미세 보정(±0.5단계까지, 6판 이상 기록된 사람만)
//  · 급수 확인 알림: 10판 이상·residual ±120 이상이면 근거로 제시(자동 변경은 하지 않음)

const SKILL_NUM: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const K = 24;
const STEP = 100; // 급수 한 단계 = 100점
export const RATING_MIN_GAMES = 6;

export interface PlayerRating {
  rating: number;
  base: number; // 급수 라벨 기준 시작점
  residual: number; // rating - base
  games: number;
  wins: number;
}

const cache = new Map<string, { at: number; data: Map<string, PlayerRating> }>();

export async function getClubRatings(clubId: string, days = 180): Promise<Map<string, PlayerRating>> {
  const hit = cache.get(clubId);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const since = new Date(Date.now() - days * 86400000);
  const turns = await prisma.courtTurn.findMany({
    where: {
      clubSession: { clubId },
      completedAt: { gte: since },
      NOT: { winnerIds: { isEmpty: true } },
    },
    orderBy: { completedAt: 'asc' },
    select: { winnerIds: true, players: { select: { userId: true } } },
  });
  const ids = Array.from(new Set(turns.flatMap((t) => t.players.map((p) => p.userId))));
  const profiles = ids.length
    ? await prisma.playerProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, skillLevel: true } })
    : [];
  const skillOf = new Map(profiles.map((p) => [p.userId, p.skillLevel ? SKILL_NUM[p.skillLevel] ?? 4 : 4]));
  const out = new Map<string, PlayerRating>();
  const get = (id: string) => {
    let r = out.get(id);
    if (!r) {
      const base = 1500 + ((skillOf.get(id) ?? 4) - 4) * STEP;
      r = { rating: base, base, residual: 0, games: 0, wins: 0 };
      out.set(id, r);
    }
    return r;
  };
  for (const t of turns) {
    const all = t.players.map((p) => p.userId);
    const w = t.winnerIds.filter((id) => all.includes(id));
    const l = all.filter((id) => !w.includes(id));
    if (w.length !== 2 || l.length !== 2) continue;
    const rw = (get(w[0]).rating + get(w[1]).rating) / 2;
    const rl = (get(l[0]).rating + get(l[1]).rating) / 2;
    const ew = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    for (const id of w) {
      const r = get(id);
      r.rating += K * (1 - ew);
      r.games++;
      r.wins++;
    }
    for (const id of l) {
      const r = get(id);
      r.rating -= K * (1 - ew);
      r.games++;
    }
  }
  for (const r of out.values()) r.residual = Math.round(r.rating - r.base);
  cache.set(clubId, { at: Date.now(), data: out });
  return out;
}

/** 팀 나누기용 급수 보정(단계) — 기록 6판 이상만, ±0.5단계로 제한. */
export function ratingSkillAdjust(r: PlayerRating | undefined): number {
  if (!r || r.games < RATING_MIN_GAMES) return 0;
  return Math.max(-0.5, Math.min(0.5, r.residual / STEP));
}

export function invalidateClubRatings(clubId: string) {
  cache.delete(clubId);
}
