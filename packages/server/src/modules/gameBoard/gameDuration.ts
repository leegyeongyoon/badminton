import { prisma } from '../../utils/prisma';

// ─── 판마다 경기 시간 예측 ─────────────────────────────────────────────
// 모임 평균 한 값(예: 12분) 대신 '이 4명이 이 방식으로 치면 몇 분'을 예측한다.
//   minutes ≈ b0 + b1·평균급수 + b2·급수폭 + b3·혼복 + b4·첫1시간 + b5·25점 + b6·15점
// 이 모임의 완료된 판(최근 120일)으로 릿지 회귀 — 표본이 적으면 아래 사전값(prior) 쪽으로 당겨진다.
// 사전값: 평균급수 높을수록 랠리가 길다(+0.4분/단계), 급수폭이 크면 일방적이라 짧다(−0.6분/단계),
// 첫 1시간은 몸 풀기라 길다(터닝 실측 13.8 vs 12.0 → +1.8분), 25점은 약 +20%, 15점은 약 −30%.
// 12시간 캐시. 경기 방식은 정모 단위(ClubSession.gameFormat, null = 21점).

export type GameFormat = '21' | '25' | '15';
export interface DurationPlayer {
  skill: number; // 1(F)~7(S)
  gender: 'M' | 'F' | null;
}
export interface DurationModel {
  coef: number[]; // [b0..b6]
  sample: number;
  source: 'club' | 'default';
  /** 방식별 이 모임 평균 예측(분) — 운영판 표시용. */
  typical: Record<GameFormat, number>;
}

const FEATURES = 7;
const FEMALE_OFFSET = 2;
const DEFAULT_BASE_MIN = 12.4;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; model: DurationModel }>();

function features(players: DurationPlayer[], format: GameFormat, firstHour: boolean): number[] {
  const eff = players.map((p) => p.skill - (p.gender === 'F' ? FEMALE_OFFSET : 0));
  const avg = eff.length ? eff.reduce((a, b) => a + b, 0) / eff.length : 3;
  const spread = eff.length ? Math.max(...eff) - Math.min(...eff) : 0;
  const mixed = players.some((p) => p.gender === 'M') && players.some((p) => p.gender === 'F') ? 1 : 0;
  // 평균급수는 4(C, 남자 기준) 중심으로 — 절편이 '보통 판' 시간이 되게.
  return [1, avg - 4, spread, mixed, firstHour ? 1 : 0, format === '25' ? 1 : 0, format === '15' ? 1 : 0];
}

function prior(base: number): number[] {
  return [base, 0.4, -0.6, 0.3, 1.8, base * 0.2, -base * 0.3];
}

// 릿지 회귀(사전값 쪽으로): (XᵀX + λI)β = Xᵀy + λ·prior
function fitRidge(X: number[][], y: number[], pri: number[], lambda: number): number[] {
  const k = FEATURES;
  // 절편(0번)은 거의 당기지 않는다 — 이 모임의 실제 평균 시간을 그대로 따르게(나머지 계수만 사전값 쪽으로).
  const lam = (i: number) => (i === 0 ? 0.01 : lambda);
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lam(i) : 0)));
  const bvec = pri.map((p, i) => lam(i) * p);
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < k; i++) {
      bvec[i] += X[r][i] * y[r];
      for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
    }
  // 가우스 소거
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [bvec[c], bvec[piv]] = [bvec[piv], bvec[c]];
    if (Math.abs(A[c][c]) < 1e-9) return pri;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      bvec[r] -= f * bvec[c];
    }
  }
  return bvec.map((v, i) => v / A[i][i]);
}

const SKILL: Record<string, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };

export async function getDurationModel(clubId: string): Promise<DurationModel> {
  const hit = cache.get(clubId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.model;
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000);
  const rows = await prisma.$queryRaw<
    { turn_id: string; minutes: number; phase: number; format: string | null; skill: string | null; gender: string | null }[]
  >`
    SELECT ct.id AS turn_id,
           EXTRACT(EPOCH FROM (ct."completedAt" - ct."startedAt")) / 60.0 AS minutes,
           EXTRACT(EPOCH FROM (ct."startedAt" - cs."startedAt")) / 60.0 AS phase,
           cs."gameFormat" AS format,
           COALESCE(cm."skillLevel"::text, pp."skillLevel"::text) AS skill,
           pp.gender::text AS gender
    FROM "CourtTurn" ct
    JOIN "ClubSession" cs ON cs.id = ct."clubSessionId"
    JOIN "TurnPlayer" tp ON tp."turnId" = ct.id
    LEFT JOIN "PlayerProfile" pp ON pp."userId" = tp."userId"
    LEFT JOIN "ClubMember" cm ON cm."userId" = tp."userId" AND cm."clubId" = cs."clubId"
    WHERE cs."clubId" = ${clubId}
      AND ct.status = 'COMPLETED'
      AND ct."startedAt" IS NOT NULL AND ct."completedAt" IS NOT NULL
      AND ct."startedAt" > ${since}
      -- 정모 종료로 강제로 끝난 판(종료 시각 = 시작+20분 상한)은 실제 경기 시간이 아니라서 뺀다.
      AND (cs."endedAt" IS NULL OR ct."completedAt" < cs."endedAt" - interval '30 seconds')
      AND ABS(EXTRACT(EPOCH FROM (ct."completedAt" - ct."startedAt")) - 1200) > 1`;
  const byTurn = new Map<string, { minutes: number; phase: number; format: GameFormat; players: DurationPlayer[] }>();
  for (const r of rows) {
    const m = Number(r.minutes);
    // 3~40분만 — 안 닫고 둔 판(40분 넘음)이 계수를 끌고 가지 않게.
    if (!(m >= 3 && m <= 40)) continue;
    let t = byTurn.get(r.turn_id);
    if (!t) {
      const f = r.format === '25' || r.format === '15' ? r.format : '21';
      t = { minutes: m, phase: Number(r.phase), format: f, players: [] };
      byTurn.set(r.turn_id, t);
    }
    t.players.push({ skill: SKILL[r.skill ?? ''] ?? 4, gender: r.gender === 'M' || r.gender === 'F' ? r.gender : null });
  }
  const turns = [...byTurn.values()].filter((t) => t.players.length === 4);
  const ys = turns.map((t) => t.minutes).sort((a, b) => a - b);
  const base = ys.length >= 20 ? ys[Math.floor(ys.length / 2)] : DEFAULT_BASE_MIN;
  const pri = prior(base);
  let coef = pri;
  if (turns.length >= 30) {
    const X = turns.map((t) => features(t.players, t.format, t.phase < 60));
    coef = fitRidge(X, turns.map((t) => t.minutes), pri, 25);
  }
  const typicalOf = (f: GameFormat) =>
    Math.round(predictWith(coef, [...Array(4)].map(() => ({ skill: 4, gender: 'M' as const })), f, false) * 10) / 10;
  const model: DurationModel = {
    coef,
    sample: turns.length,
    source: turns.length >= 30 ? 'club' : 'default',
    typical: { '21': typicalOf('21'), '25': typicalOf('25'), '15': typicalOf('15') },
  };
  cache.set(clubId, { at: Date.now(), model });
  return model;
}

function predictWith(coef: number[], players: DurationPlayer[], format: GameFormat, firstHour: boolean): number {
  const x = features(players, format, firstHour);
  let m = 0;
  for (let i = 0; i < FEATURES; i++) m += coef[i] * x[i];
  return Math.min(35, Math.max(6, m));
}

/** 이 4명이 이 방식으로 칠 때 예상 시간(분). firstHour = 정모 시작 1시간 안에 시작하는 판. */
export function predictGameMin(model: DurationModel, players: DurationPlayer[], format: GameFormat, firstHour: boolean): number {
  return predictWith(model.coef, players, format, firstHour);
}

export function normalizeFormat(f: string | null | undefined): GameFormat {
  return f === '25' || f === '15' ? f : '21';
}
