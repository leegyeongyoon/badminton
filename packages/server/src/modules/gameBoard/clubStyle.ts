/**
 * 모임 편성 스타일 학습 — "이 모임 총무는 4명을 어떻게 묶나"를 모임의 실제 기록에서 배운다.
 *
 * 방식(조건부 로짓): 과거 편성 시점마다 [실제로 짠 4명] vs [그중 1~2명을 그때 대기하던 다른
 * 사람으로 바꾼 가상 조합]을 비교해, 실제 조합을 고르게 만든 특징의 가중치를 로지스틱 회귀로 학습.
 * 터닝포인트 실측(2026-10, 2,794편성): 테스트 정확도 79.7% — 남복/여복 선호, 급수 폭 좁게,
 * 혼복은 2:2, 팀 균형, 자주 치던 사람끼리.
 *
 * 의도적으로 학습에서 뺀 것: '오늘 이미 같이 친 짝'. 사람 총무는 무작위보다 더 겹치게 짜지만
 * (+0.42) 그게 회원 불만(중복 게임)의 원인이라, 그 부분은 사람을 따라 하지 않고 기존 variety
 * 항이 계속 피하게 둔다.
 *
 * 결과는 모임별 12시간 캐시. 표본이 적은 모임은 null(기본 규칙만 사용).
 */
import { prisma } from '../../utils/prisma';

const SKILL: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const LOOKBACK_DAYS = 120;
const MIN_DECISIONS = 150;
const TTL_MS = 12 * 3600 * 1000;
const GAME_EST_SEC = 13 * 60;
const NEG_PER_DECISION = 8;

export const STYLE_FEATURES = [
  'skillSpread', // 급수 폭(최고−최저)
  'teamDiff', // 최선 2:2 팀 실력 차(여자 −1 보정)
  'sameGender', // 남복/여복
  'mixed22', // 혼복 2:2
  'historyLog', // 과거(이전 정모) 함께 친 판수 합 log1p
  'regulars', // 과거 3판+ 함께 친 단골 짝 쌍 수
  'guests', // 게스트 수
] as const;

export interface StylePlayer {
  id: string;
  skill: number;
  gender: 'M' | 'F' | null;
  guest: boolean;
}

export interface ClubStyle {
  clubId: string;
  /** 원단위 가중치(로그 오즈). utility = Σ w·feature, 클수록 '이 모임다운' 조합. */
  weights: number[];
  /** 표준화 가중치(영향력 비교용). */
  stdWeights: number[];
  decisions: number;
  testAccuracy: number | null;
  traits: string[];
  /** 학습 기간의 '정모 간' 함께 친 횟수(pairKey → 판수). 스코어링 때 단골 짝 판정에 쓴다. */
  history: Map<string, number>;
  /** 운영진이 짠 판의 95%가 지킨 급수 폭(여자 2단계 보정) — 엔진의 하드 상한. */
  spreadCap: number;
  trainedAt: string;
}

const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// 여자 급수 보정(남자 기준) — 운영진 확인: 여자는 2단계 후하다(여 A ≈ 남 C).
export const FEMALE_OFFSET = 2;
/** 기록이 없을 때 한 판 급수 폭(보정) 상한 기본값. */
export const DEFAULT_SPREAD_CAP = 2;

export function styleFeatures(group: StylePlayer[], history: Map<string, number>): number[] {
  const sk = group.map((p) => p.skill);
  const eff = group.map((p) => p.skill - (p.gender === 'F' ? FEMALE_OFFSET : 0));
  const [a, b, c, d] = eff;
  const teamDiff = group.length === 4 ? Math.min(Math.abs(a + b - c - d), Math.abs(a + c - b - d), Math.abs(a + d - b - c)) : 0;
  const f = group.filter((p) => p.gender === 'F').length;
  let hsum = 0;
  let regulars = 0;
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++) {
      const h = history.get(pk(group[i].id, group[j].id)) ?? 0;
      hsum += h;
      if (h >= 3) regulars++;
    }
  return [
    Math.max(...sk) - Math.min(...sk),
    teamDiff,
    f === 0 || f === group.length ? 1 : 0,
    f === 2 && group.length === 4 ? 1 : 0,
    Math.log1p(hsum),
    regulars,
    group.filter((p) => p.guest).length,
  ];
}

export function styleUtility(style: ClubStyle, group: StylePlayer[]): number {
  const x = styleFeatures(group, style.history);
  let u = 0;
  for (let j = 0; j < x.length; j++) u += style.weights[j] * x[j];
  return u;
}

// 결정적 PRNG(학습 재현성).
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// 차이 벡터 로지스틱(절편 없음, sd 스케일만) — SGD + Adagrad.
function fitPairwise(X: number[][], y: number[], rand: () => number, epochs = 12, lr = 0.1, l2 = 1e-3) {
  const n = X.length;
  const k = X[0].length;
  const sd = new Array(k).fill(0).map((_, j) => {
    let s = 0;
    for (const r of X) s += r[j] * r[j];
    return Math.max(1e-9, Math.sqrt(s / n));
  });
  const w = new Array(k).fill(0);
  const g2 = new Array(k).fill(1e-8);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let e = 0; e < epochs; e++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (const i of idx) {
      let z = 0;
      for (let j = 0; j < k; j++) z += (w[j] * X[i][j]) / sd[j];
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const err = p - y[i];
      for (let j = 0; j < k; j++) {
        const g = (err * X[i][j]) / sd[j] + l2 * w[j];
        g2[j] += g * g;
        w[j] -= (lr * g) / Math.sqrt(g2[j]);
      }
    }
  }
  return { stdWeights: w, weights: w.map((v, j) => v / sd[j]) };
}

function describe(std: number[]): string[] {
  const out: { t: string; s: number }[] = [];
  const at = (name: (typeof STYLE_FEATURES)[number]) => std[STYLE_FEATURES.indexOf(name)];
  if (at('sameGender') > 0.2) out.push({ t: '남복·여복 위주', s: at('sameGender') });
  if (at('skillSpread') < -0.2) out.push({ t: '급수 비슷한 사람끼리', s: -at('skillSpread') });
  if (at('mixed22') > 0.2) out.push({ t: '혼복은 남녀 2:2로', s: at('mixed22') });
  if (at('teamDiff') < -0.2) out.push({ t: '팀 실력 균형', s: -at('teamDiff') });
  if (at('historyLog') + at('regulars') > 0.3) out.push({ t: '평소 같이 치던 사람끼리', s: at('historyLog') + at('regulars') });
  if (at('guests') < -0.3) out.push({ t: '게스트는 나눠서', s: -at('guests') });
  return out.sort((a, b) => b.s - a.s).map((o) => o.t);
}

export async function trainClubStyle(clubId: string): Promise<ClubStyle | null> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const sessions = await prisma.clubSession.findMany({
    where: { clubId, startedAt: { gte: since } },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  });
  if (sessions.length < 3) return null;
  const sids = sessions.map((s) => s.id);
  const [turns, checkins] = await Promise.all([
    prisma.courtTurn.findMany({
      where: { clubSessionId: { in: sids }, startedAt: { not: null } },
      select: {
        clubSessionId: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        players: { select: { userId: true } },
        gameBoardEntry: { select: { createdAt: true } },
      },
    }),
    prisma.checkIn.findMany({
      where: { clubSessionId: { in: sids } },
      select: { clubSessionId: true, userId: true, checkedInAt: true, checkedOutAt: true },
    }),
  ]);

  const uids = Array.from(new Set([...checkins.map((c) => c.userId), ...turns.flatMap((t) => t.players.map((p) => p.userId))]));
  const [users, profiles, members] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, isGuest: true } }),
    prisma.playerProfile.findMany({ where: { userId: { in: uids } }, select: { userId: true, skillLevel: true, gender: true } }),
    prisma.clubMember.findMany({ where: { clubId, userId: { in: uids } }, select: { userId: true, skillLevel: true } }),
  ]);
  const guestOf = new Map(users.map((u) => [u.id, u.isGuest]));
  const profOf = new Map(profiles.map((p) => [p.userId, p]));
  const clubSkill = new Map(members.map((m) => [m.userId, m.skillLevel]));
  const pcache = new Map<string, StylePlayer>();
  const player = (id: string): StylePlayer => {
    let p = pcache.get(id);
    if (!p) {
      const prof = profOf.get(id);
      const lv = clubSkill.get(id) ?? prof?.skillLevel ?? null;
      const g = prof?.gender;
      p = { id, skill: lv ? SKILL[lv] ?? 4 : 4, gender: g === 'M' || g === 'F' ? g : null, guest: !!guestOf.get(id) };
      pcache.set(id, p);
    }
    return p;
  };

  type T = { dec: number; start: number; end: number; ids: string[] };
  const bySession = new Map<string, T[]>();
  for (const t of turns) {
    const ids = t.players.map((p) => p.userId);
    const arr = bySession.get(t.clubSessionId!) ?? [];
    const start = t.startedAt!.getTime() / 1000;
    arr.push({
      dec: (t.gameBoardEntry?.createdAt ?? t.createdAt).getTime() / 1000,
      start,
      end: t.completedAt ? t.completedAt.getTime() / 1000 : start + GAME_EST_SEC,
      ids,
    });
    bySession.set(t.clubSessionId!, arr);
  }
  const ckBySession = new Map<string, Map<string, { tin: number; tout: number }>>();
  for (const c of checkins) {
    if (!c.clubSessionId) continue;
    const m = ckBySession.get(c.clubSessionId) ?? new Map();
    const tin = c.checkedInAt.getTime() / 1000;
    const tout = c.checkedOutAt ? c.checkedOutAt.getTime() / 1000 : Infinity;
    const prev = m.get(c.userId);
    if (!prev || tin < prev.tin) m.set(c.userId, { tin, tout });
    ckBySession.set(c.clubSessionId, m);
  }

  const rand = mulberry32(7);
  const history = new Map<string, number>();
  const rows: { si: number; diff: number[] }[] = [];
  let decisions = 0;

  sessions.forEach((s, si) => {
    const ts = (bySession.get(s.id) ?? []).sort((a, b) => a.dec - b.dec);
    const ck = ckBySession.get(s.id) ?? new Map();
    for (const t of ts) {
      if (t.ids.length !== 4) continue;
      const T = t.dec;
      const pending = new Set<string>();
      const playing = new Set<string>();
      const lastEnd = new Map<string, number>();
      for (const u of ts) {
        if (u === t) continue;
        if (u.dec < T && u.start > T) u.ids.forEach((id) => pending.add(id));
        if (u.start < T) {
          for (const id of u.ids) {
            if (u.end > T) playing.add(id);
            else lastEnd.set(id, Math.max(lastEnd.get(id) ?? 0, u.end));
          }
        }
      }
      // 바꿔 넣을 후보: 그때 체크인 · 대기 중 · 다른 대기 게임 없음 · 안 뽑힘 → 대기 오래된 12명.
      const alt: { id: string; wait: number }[] = [];
      for (const [uid, { tin, tout }] of ck) {
        if (tin > T || tout <= T || pending.has(uid) || playing.has(uid) || t.ids.includes(uid)) continue;
        alt.push({ id: uid, wait: T - Math.max(tin, lastEnd.get(uid) ?? 0) });
      }
      if (alt.length === 0) continue;
      alt.sort((a, b) => b.wait - a.wait);
      const top = alt.slice(0, 12);
      decisions++;
      const chosen = t.ids.map(player);
      const fc = styleFeatures(chosen, history);
      for (let n = 0; n < NEG_PER_DECISION; n++) {
        const g = [...t.ids];
        const k = rand() < 0.6 ? 1 : 2;
        const slots = [0, 1, 2, 3].sort(() => rand() - 0.5).slice(0, k);
        for (const pos of slots) g[pos] = top[Math.floor(rand() * top.length)].id;
        if (new Set(g).size !== 4) continue;
        const fn = styleFeatures(g.map(player), history);
        rows.push({ si, diff: fc.map((v, j) => v - fn[j]) });
      }
    }
    // 정모가 끝나면 이번 정모 짝을 '과거'로 누적(다음 정모부터 단골 판정에 사용, 누수 없음).
    for (const u of ts) {
      if (u.ids.length !== 4) continue;
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const key = pk(u.ids[i], u.ids[j]);
          history.set(key, (history.get(key) ?? 0) + 1);
        }
    }
  });

  if (decisions < MIN_DECISIONS || rows.length === 0) return null;

  // 운영진 급수 폭 규칙 — 학습 기간 4인 판의 보정 급수 폭 95% 지점(1~3으로 제한).
  const spreads: number[] = [];
  for (const arr of bySession.values())
    for (const t of arr) {
      if (t.ids.length !== 4) continue;
      const e = t.ids.map((id) => {
        const p = player(id);
        return p.skill - (p.gender === 'F' ? FEMALE_OFFSET : 0);
      });
      spreads.push(Math.max(...e) - Math.min(...e));
    }
  spreads.sort((a, b) => a - b);
  const p95 = spreads.length ? spreads[Math.min(spreads.length - 1, Math.floor(spreads.length * 0.95))] : DEFAULT_SPREAD_CAP;
  const spreadCap = Math.max(1, Math.min(3, p95));

  const cut = Math.floor(sessions.length * 0.8);
  const toXY = (rs: typeof rows) => {
    const X: number[][] = [];
    const y: number[] = [];
    for (const r of rs) {
      X.push(r.diff);
      y.push(1);
      X.push(r.diff.map((v) => -v));
      y.push(0);
    }
    return { X, y };
  };
  const trainRows = rows.filter((r) => r.si < cut);
  const testRows = rows.filter((r) => r.si >= cut);
  const { X, y } = toXY(trainRows.length > 0 ? trainRows : rows);
  const model = fitPairwise(X, y, rand);
  let testAccuracy: number | null = null;
  if (testRows.length > 0) {
    let win = 0;
    for (const r of testRows) {
      const z = r.diff.reduce((s, v, j) => s + model.weights[j] * v, 0);
      win += z > 0 ? 1 : z === 0 ? 0.5 : 0;
    }
    testAccuracy = Math.round((win / testRows.length) * 1000) / 10;
  }

  return {
    clubId,
    weights: model.weights,
    stdWeights: model.stdWeights,
    decisions,
    testAccuracy,
    traits: describe(model.stdWeights),
    history,
    spreadCap,
    trainedAt: new Date().toISOString(),
  };
}

const cache = new Map<string, { at: number; style: ClubStyle | null }>();
const inflight = new Map<string, Promise<ClubStyle | null>>();

export async function getClubStyle(clubId: string): Promise<ClubStyle | null> {
  const hit = cache.get(clubId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.style;
  let p = inflight.get(clubId);
  if (!p) {
    p = trainClubStyle(clubId)
      .catch(() => null)
      .then((style) => {
        cache.set(clubId, { at: Date.now(), style });
        inflight.delete(clubId);
        return style;
      });
    inflight.set(clubId, p);
  }
  return p;
}
