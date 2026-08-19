/**
 * 콕고 랠리 v1 — 게임 엔진 (순수 로직, React/렌더링 무관).
 *
 * 축 모델: 사이드뷰에서 정직하게 표현되는 축은 좌우가 아니라 앞뒤이므로
 * v1의 존(Zone)은 깊이다 — 0=네트 앞, 1=중위, 2=백코트. 샷 선택이 곧
 * 코스(낙하 깊이)이고, 예측 스텝은 앞뒤 이동이다. 좌우 코스는 v2.
 *
 * v2 대전에서 이 파일을 서버로 이식해 판정을 공유할 수 있도록
 * 여기에는 시간·난수 외 부수효과를 두지 않는다.
 */

export type Zone = 0 | 1 | 2; // 0=네트 앞, 1=중위, 2=백코트
export type Side = 'player' | 'ai';
export type ShotType = 'clear' | 'smash' | 'drop' | 'hairpin' | 'lift' | 'block' | 'drive';
export type Quality = 'perfect' | 'good' | 'bad';
export type Posture = 'ready' | 'pushed'; // 여유/밀림 (한계·점프스매시는 v3)
export type BallKind = 'high' | 'net' | 'smash'; // 받는 쪽이 마주하는 공
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Flight {
  shot: ShotType;
  by: Side;
  quality: Quality;
  kind: BallKind; // 리시버가 마주하는 공의 종류
  toZone: Zone; // 낙하 깊이 (리시버 코트 기준)
  ms: number; // 비행 시간
  apex: number; // 포물선 높이 0..1 (렌더링용)
  chance: boolean; // 뜬공(찬스볼) 여부 — 리시버가 여유를 얻는다
}

export interface Score {
  player: number;
  ai: number;
}

export interface MatchConfig {
  target: 7 | 11 | 21;
  deuce: boolean;
  difficulty: Difficulty;
}

// ─── 튜닝 상수 — 손맛은 전부 여기서 조정한다 ─────────────────────────
const SHOT_SPEC: Record<ShotType, { ms: number; apex: number; toZone: Zone; kind: BallKind }> = {
  clear: { ms: 1150, apex: 0.9, toZone: 2, kind: 'high' },
  lift: { ms: 1200, apex: 0.95, toZone: 2, kind: 'high' },
  drop: { ms: 900, apex: 0.55, toZone: 0, kind: 'net' },
  hairpin: { ms: 850, apex: 0.28, toZone: 0, kind: 'net' },
  block: { ms: 800, apex: 0.3, toZone: 0, kind: 'net' },
  smash: { ms: 520, apex: 0.12, toZone: 1, kind: 'smash' },
  drive: { ms: 640, apex: 0.2, toZone: 1, kind: 'smash' },
};

// 타이밍 창 반폭(ms) — 퍼펙트/굿/배드. 이 바깥은 미스.
const WINDOWS: Record<Difficulty, { p: number; g: number; b: number }> = {
  easy: { p: 90, g: 190, b: 340 },
  normal: { p: 70, g: 155, b: 280 },
  hard: { p: 55, g: 125, b: 235 },
};

// AI 샷 퀄리티 분포 [perfect, good, bad, miss]
const AI_QUALITY: Record<Difficulty, [number, number, number, number]> = {
  easy: [0.1, 0.45, 0.3, 0.15],
  normal: [0.2, 0.55, 0.19, 0.06],
  hard: [0.32, 0.53, 0.12, 0.03],
};

const DEUCE_CAP: Record<number, number> = { 7: 10, 11: 15, 21: 30 };

export const HOME_ZONE: Zone = 1;

// ─── 랠리 가속 — 판은 반드시 끝난다 ─────────────────────────────────
export function rallySpeed(rallyLen: number): number {
  return Math.max(0.62, 1 - rallyLen * 0.028);
}

function windowScale(rallyLen: number): number {
  return Math.max(0.72, 1 - rallyLen * 0.014);
}

// ─── 자세(풋워크) — 샷은 손이 아니라 발이 결정한다 ───────────────────
// pos: 리시버의 준비 위치(예측 스텝 반영), flight: 날아오는 공.
export function computePosture(pos: Zone, anticip: Zone | null, flight: Flight): Posture {
  if (flight.chance) return 'ready'; // 뜬공은 누구에게나 여유
  const speed = flight.ms < 620 ? 1.0 : flight.ms < 920 ? 0.4 : 0;
  let pressure: number;
  if (anticip !== null) {
    pressure =
      anticip === flight.toZone
        ? speed * 0.3 // 예측 적중 — 수비가 찬스로
        : Math.abs(anticip - flight.toZone) * 0.9 + speed + 0.25; // 예측 실패 — 홈보다 더 밀림
  } else {
    pressure = Math.abs(pos - flight.toZone) * 0.8 + speed;
  }
  return pressure >= 1.4 ? 'pushed' : 'ready';
}

// ─── 샷 메뉴 — 자세 × 공 종류가 선택지를 결정 ───────────────────────
export function shotMenu(kind: BallKind, posture: Posture): ShotType[] {
  if (kind === 'high') return posture === 'ready' ? ['clear', 'smash', 'drop'] : ['clear'];
  if (kind === 'net') return posture === 'ready' ? ['hairpin', 'lift'] : ['lift'];
  return posture === 'ready' ? ['block', 'lift'] : ['lift']; // smash 수비
}

// ─── 샷 → 비행 결정 ────────────────────────────────────────────────
// 밀린 자세의 클리어는 하프클리어(중위 낙하 + 뜬공)가 된다.
// 배드 퀄리티는 뜬공. 배드 스매시는 아웃(호출부에서 처리) — 리스크의 대가.
export function resolveShot(
  shot: ShotType,
  quality: Quality,
  by: Side,
  posture: Posture,
  rallyLen: number,
): Flight {
  const spec = SHOT_SPEC[shot];
  let { ms, apex, toZone, kind } = spec;
  let chance = false;

  if (quality === 'perfect') {
    if (shot === 'smash') ms *= 0.85;
    if (shot === 'drop' || shot === 'hairpin') ms *= 0.94;
  } else if (quality === 'bad') {
    // 뜬공 — 느리고 높게, 중위로 떠서 상대 찬스
    ms *= 1.25;
    apex = Math.min(1, apex + 0.2);
    toZone = 1;
    kind = 'high';
    chance = true;
  }

  if (shot === 'clear' && posture === 'pushed') {
    // 하프클리어 — 밀린 발로 친 클리어는 뒤까지 못 간다
    ms *= 0.88;
    toZone = 1;
    chance = true;
  }

  ms *= rallySpeed(rallyLen);
  return { shot, by, quality, kind, toZone, ms: Math.round(ms), apex, chance };
}

// 서브 — 숏(네트 앞)/롱(백코트). 게이지 phase(0..1, 1=정점)로 퀄리티.
export function resolveServe(kind: 'short' | 'long', phase: number, by: Side): Flight {
  const quality: Quality = phase > 0.92 ? 'perfect' : phase > 0.65 ? 'good' : 'bad';
  const base = kind === 'short' ? SHOT_SPEC.hairpin : SHOT_SPEC.clear;
  const f: Flight = {
    shot: kind === 'short' ? 'hairpin' : 'clear',
    by,
    quality,
    kind: kind === 'short' ? 'net' : 'high',
    toZone: kind === 'short' ? 0 : 2,
    ms: Math.round(base.ms * 1.05),
    apex: base.apex,
    chance: false,
  };
  if (quality === 'bad') {
    // 어설픈 서브 — 뜬공으로 시작하는 최악의 출발
    f.ms = Math.round(f.ms * 1.15);
    f.toZone = 1;
    f.kind = 'high';
    f.chance = true;
  }
  return f;
}

// ─── 타이밍 판정 ───────────────────────────────────────────────────
export interface TimingWindows {
  p: number;
  g: number;
  b: number;
}

export function windowsFor(
  flight: Flight,
  posture: Posture,
  diff: Difficulty,
  rallyLen: number,
): TimingWindows {
  const base = WINDOWS[diff];
  let k = windowScale(rallyLen);
  if (posture === 'pushed') k *= 0.7;
  if (flight.chance) k *= 1.6;
  if (flight.kind === 'smash') k *= 0.75;
  return { p: base.p * k, g: base.g * k, b: base.b * k };
}

export function judgeTiming(deltaMs: number, w: TimingWindows): Quality | 'miss' {
  const d = Math.abs(deltaMs);
  if (d <= w.p) return 'perfect';
  if (d <= w.g) return 'good';
  if (d <= w.b) return 'bad';
  return 'miss';
}

// ─── AI ────────────────────────────────────────────────────────────
export interface AiDecision {
  miss: boolean;
  shot?: ShotType;
  quality?: Quality;
}

export function aiRespond(incoming: Flight, diff: Difficulty, rallyLen: number): AiDecision {
  // 하드 AI는 30% 확률로 예측 성공(여유), 나머지는 홈포지션 기준
  const anticip: Zone | null = diff === 'hard' && Math.random() < 0.3 ? incoming.toZone : null;
  const posture = computePosture(HOME_ZONE, anticip, incoming);

  let [p, g, b, miss] = AI_QUALITY[diff];
  if (posture === 'pushed') {
    miss += 0.14;
    b += 0.08;
  }
  if (incoming.kind === 'smash' && incoming.quality === 'perfect') miss += 0.2;
  if (incoming.chance) {
    p += 0.22;
    miss = Math.max(0.01, miss - 0.05);
  }
  miss += Math.min(0.15, rallyLen * 0.008); // 랠리가 길어지면 AI도 지친다

  const roll = Math.random();
  const total = p + g + b + miss;
  if (roll > (p + g + b) / total) return { miss: true };
  const quality: Quality = roll < p / total ? 'perfect' : roll < (p + g) / total ? 'good' : 'bad';

  const menu = shotMenu(incoming.kind, posture);
  const shot = aiPickShot(menu, diff, incoming.chance);
  // AI의 배드 스매시도 아웃 — 플레이어와 같은 규칙
  return { miss: shot === 'smash' && quality === 'bad', shot, quality };
}

function aiPickShot(menu: ShotType[], diff: Difficulty, chanceBall: boolean): ShotType {
  if (menu.length === 1) return menu[0];
  const smashW = diff === 'hard' ? 0.55 : diff === 'normal' ? 0.42 : 0.3;
  const weights = menu.map((s) => {
    if (s === 'smash') return chanceBall ? smashW + 0.3 : smashW;
    if (s === 'drop') return 0.3;
    if (s === 'clear') return 0.28;
    if (s === 'hairpin') return 0.5;
    return 0.4; // lift/block
  });
  const sum = weights.reduce((a, w) => a + w, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < menu.length; i++) {
    r -= weights[i];
    if (r <= 0) return menu[i];
  }
  return menu[menu.length - 1];
}

// AI가 밀린 자세의 클리어를 치면 하프클리어가 되도록 posture도 재계산해 전달
export function aiPosture(incoming: Flight, diff: Difficulty): Posture {
  const anticip: Zone | null = diff === 'hard' && Math.random() < 0.3 ? incoming.toZone : null;
  return computePosture(HOME_ZONE, anticip, incoming);
}

// ─── 점수·듀스 ─────────────────────────────────────────────────────
export function gameWinner(score: Score, cfg: MatchConfig): Side | null {
  const { player, ai } = score;
  const t = cfg.target;
  const cap = DEUCE_CAP[t];
  const lead = Math.abs(player - ai);
  const hi = Math.max(player, ai);
  const leader: Side = player > ai ? 'player' : 'ai';
  if (!cfg.deuce) return hi >= t ? leader : null;
  if (hi >= cap) return leader; // 하드 캡 — 7점: 10, 11점: 15, 21점: 30
  if (hi >= t && lead >= 2) return leader;
  return null;
}

export function isDeuce(score: Score, cfg: MatchConfig): boolean {
  if (!cfg.deuce) return false;
  return score.player >= cfg.target - 1 && score.ai >= cfg.target - 1;
}
