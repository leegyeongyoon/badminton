/**
 * 콕고 랠리 — 직접 조종 시뮬레이션 (v1.5).
 *
 * 조이스틱으로 캐릭터를 직접 움직이고, 셔틀은 3D 궤적(베지어)으로 난다.
 * 풋워크·코스 싸움이 추상 존이 아니라 실제 거리에서 나온다:
 * 낙하점에 발이 못 가면 못 치고, AI도 실제로 달려가서 못 따라가면 위너.
 * 렌더링·React 무관 — 화면은 tick()이 갱신한 상태를 투영해 그리기만 한다.
 */
import {
  Difficulty,
  MatchConfig,
  Quality,
  Score,
  ShotType,
  Side,
  gameWinner,
  isDeuce,
} from './engine';
import { COURT } from './court3d';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Anim = 'idle' | 'run' | 'swing' | 'lunge';

/** 리깅 캐릭터의 샷별 스윙 클립 키 — 렌더러(RigCharacter)가 이 값으로 모션을 고른다 */
export type MotionKey =
  | 'overhead' | 'smashJump' | 'under' | 'netPush' | 'drive' | 'lunge' | 'cheer'
  | 'backOverhead' | 'backDrive' | 'backUnder' | 'backNet' | 'round';

/** 스윙 손 — 포핸드 / 백핸드 / 라운드(백 쪽 높은 공을 포핸드로 돌아 침) */
export type SwingHand = 'fore' | 'back' | 'round';

/** 컨택 위치×손잡이 → 스윙 손. 라켓 반대쪽 높은 공은 발이 갔으면 라운드, 아니면 백핸드 */
function handFor(racketSign: 1 | -1, dxBall: number, z: number, distQ: number): SwingHand {
  if (dxBall * racketSign >= -0.15) return 'fore';
  if (z >= 1.55 && distQ >= 1) return 'round';
  return 'back';
}

/** 백핸드 모션 매핑 */
function motionForHand(base: MotionKey, hand: SwingHand): MotionKey {
  if (hand === 'round') return 'round';
  if (hand !== 'back') return base;
  switch (base) {
    case 'overhead':
    case 'smashJump': return 'backOverhead';
    case 'drive': return 'backDrive';
    case 'under': return 'backUnder';
    case 'netPush': return 'backNet';
    default: return base;
  }
}

export function motionFor(shot: ShotType, serve = false, kind?: 'short' | 'long'): MotionKey {
  if (serve) return kind === 'short' ? 'netPush' : 'under';
  switch (shot) {
    case 'smash': return 'smashJump';
    case 'clear':
    case 'drop': return 'overhead';
    case 'drive': return 'drive';
    case 'hairpin':
    case 'block': return 'netPush';
    default: return 'under'; // lift
  }
}

export interface Actor {
  x: number;
  y: number;
  anim: Anim;
  animUntil: number;
  moving: boolean;
  facing: 1 | -1; // 좌우 시선(연출용)
  motion?: MotionKey; // 마지막 스윙의 모션 클립
  /** 오는 공이 가까움 — 렌더러가 백스윙을 미리 젖힌다(임팩트 타이밍 체감) */
  windup?: boolean;
  /** 체력 0..1 — 뛰고 휘두르면 닳고, 포인트 사이·서브 대기에 회복.
   *  낮으면 이동이 느려지고 스매시 퍼펙트가 안 나온다 — 클리어로 상대를
   *  뛰게 만들어 지치게 하는 실제 배드민턴 운영이 성립한다. */
  stamina?: number;
}

export interface Traj {
  by: Side;
  shot: ShotType;
  quality: Quality;
  chance: boolean;
  serve?: boolean; // 서브 궤적 — 폴트 문구 처리용
  cross?: boolean; // 크로스(대각) 샷 — 비행이 길지만 상대를 넓게 뛰게 한다
  p0: Vec3;
  c: Vec3;
  p2: Vec3;
  t0: number;
  dur: number; // ms
  landing: 'in' | 'out' | 'net';
  aiHandled: boolean;
  /** 뜬공 응징 스매시 — 수비자의 캐치 반경이 반토막 난다 */
  punish?: boolean;
}

export type SimPhase = 'serve' | 'rally' | 'point' | 'over';

export interface SimState {
  /** 시뮬레이션 자체 클록(ms) — tick이 감는다. 벽시계를 쓰지 않으므로
   *  앱이 백그라운드로 갔다 와도 셔틀이 순간이동하지 않고 그대로 일시정지된다. */
  clock: number;
  phase: SimPhase;
  config: MatchConfig;
  /** PvP 모드 — AI 자동 행동(서브·이동·스윙)을 끄고 원격 입력이 s.ai를 조종한다.
   *  호스트만 sim을 돌리고 게스트는 스냅샷 미러를 받는다(호스트 권위). */
  pvp?: boolean;
  /** 플레이어 왼손잡이 — 백핸드/라운드 판정과 AI의 백핸드 공략 방향이 바뀐다 */
  leftHand?: boolean;
  /** PvP 게스트 손잡이 (호스트 sim에서 원격 스윙 판정에 사용) */
  remoteLeftHand?: boolean;
  score: Score;
  server: Side;
  rallyLen: number;
  deuce: boolean;
  player: Actor;
  ai: Actor;
  shuttle: Vec3;
  traj: Traj | null;
  banner: { winner: Side; reason: string } | null;
  bannerUntil: number;
  aiServeAt: number;
  winner: Side | null;
  stats: { longestRally: number; perfects: number; perfectsRemote?: number };
  lastShot: {
    shot: ShotType;
    quality: Quality;
    whiff?: boolean;
    serve?: boolean;
    cross?: boolean;
    cut?: boolean; // 높은 타점에서 자른 드롭
    weak?: 'late' | 'stretch'; // 배드의 원인 — 낮은 타점 / 밀린 발
    by?: Side; // PvP: 누구의 스윙인지 — 팝업을 각자 자기 것만 띄우기 위해
    hand?: SwingHand; // 백핸드/라운드 — 팝업 표기용
  } | null;
  events: string[];
}

// ─── 서브 규칙 — 짝수 점수는 오른쪽, 홀수는 왼쪽 서비스 코트에서 대각선으로 ───
export interface ServeSpots {
  server: { x: number; y: number };
  receiver: { x: number; y: number };
  targetSign: 1 | -1; // 서비스 박스(리시버 코트)의 화면 x 부호
  right: boolean; // 서버 기준 우측 코트 여부
}

export function serveSpots(s: SimState): ServeSpots {
  const even = s.score[s.server] % 2 === 0;
  if (s.server === 'player') {
    const sign = even ? 1 : -1; // 플레이어의 오른쪽 = 화면 오른쪽
    return {
      server: { x: 1.5 * sign, y: -2.9 },
      receiver: { x: -1.5 * sign, y: 3.3 },
      targetSign: (sign * -1) as 1 | -1,
      right: even,
    };
  }
  const sign = even ? -1 : 1; // AI의 오른쪽 = 화면 왼쪽
  return {
    server: { x: 1.5 * sign, y: 2.9 },
    receiver: { x: -1.5 * sign, y: -3.3 },
    targetSign: (sign * -1) as 1 | -1,
    right: even,
  };
}

// 게임식 버튼 조작 — 공격(스매시/네트킬)·연결(클리어/헤어핀)·드롭
export type SwingIntent = 'attack' | 'rally' | 'drop';
/** 서브 종류 — 플릭은 숏서브와 같은 모션으로 시작해 깊게 튕기는 기습(심리전) */
export type ServeKind = 'short' | 'long' | 'flick';
/** 좌우 코스 — 연속값(-1..1, 끝까지 기울이면 사이드라인 와이드) 또는 'auto'(빈 코트) */
export type AimLane = number | 'auto';
/** 깊이 코스 — 스윙 순간 스틱 앞뒤: -1 짧게(네트 쪽) / 0 기본 / 1 깊게(백라인) */
export type AimDepth = -1 | 0 | 1;

// ─── 튜닝 상수 ─────────────────────────────────────────────────────
const PLAYER_SPEED = 4.8; // m/s — 사람이 코트를 커버할 수 있게 넉넉히
const AI_SPEED: Record<Difficulty, number> = { easy: 2.55, normal: 3.15, hard: 4.4 };
const REACH_PERFECT = 0.6;
const REACH_GOOD = 1.05;
const REACH_MAX = 1.45; // 런지 한계 — 이 밖이면 헛스윙 (AI 캐치 판정용)
// 사람 쪽 리치는 난이도별로 관대하게 — easy가 '진짜 쉬움'이 되는 핵심 레버
const REACH_BY_DIFF: Record<Difficulty, { p: number; g: number; m: number }> = {
  easy: { p: 0.8, g: 1.32, m: 1.78 },
  normal: { p: 0.7, g: 1.18, m: 1.6 },
  hard: { p: 0.6, g: 1.05, m: 1.45 },
};
// 난이도별 셔틀 페이스 — 쉬움은 느긋하게, 어려움은 빠르게
const DIFF_PACE: Record<Difficulty, number> = { easy: 1.3, normal: 1.12, hard: 1.0 };

// 스매시 수비 — 반응 지연(u)과 캐치 반경 배율. 응징(뜬공) 스매시는 거의 못 받는다
const SMASH_DEF: Record<Difficulty, { react: number; catchR: number; punishR: number }> = {
  easy: { react: 0.42, catchR: 0.75, punishR: 0.28 },
  normal: { react: 0.36, catchR: 0.85, punishR: 0.4 },
  hard: { react: 0.28, catchR: 1.0, punishR: 0.58 },
};

// 샷 스펙: 비행시간(ms), 정점 높이(m), 상대 코트 목표 깊이 y 범위
// 사람 반응속도 기준 페이스 — 랠리가 '만들어질' 여유를 준다
const SHOT3: Record<ShotType, { dur: number; apex: number; yMin: number; yMax: number }> = {
  clear: { dur: 1600, apex: 4.6, yMin: 4.6, yMax: 6.2 },
  lift: { dur: 1750, apex: 5.2, yMin: 4.2, yMax: 6.0 },
  drop: { dur: 1300, apex: 2.7, yMin: 0.9, yMax: 1.8 },
  hairpin: { dur: 1150, apex: 1.95, yMin: 0.5, yMax: 1.1 },
  block: { dur: 1100, apex: 1.9, yMin: 0.8, yMax: 1.6 },
  smash: { dur: 680, apex: 0, yMin: 2.2, yMax: 3.6 }, // apex 0 = 직선 강하
  drive: { dur: 850, apex: 1.95, yMin: 3.0, yMax: 4.6 }, // 네트를 스치는 평평한 속공
};

// AI 스윙 퀄리티 분포 [perfect, good, bad]
const AI_Q: Record<Difficulty, [number, number, number]> = {
  easy: [0.08, 0.42, 0.5],
  normal: [0.18, 0.51, 0.31],
  hard: [0.45, 0.48, 0.07],
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

// 체력 → 이동속도 배율 (바닥이어도 72%는 유지 — 답답하지 않게)
const spMult = (st?: number) => 0.72 + 0.28 * Math.max(0, Math.min(1, st ?? 1));
const drain = (a: Actor, amt: number) => {
  a.stamina = Math.max(0, Math.min(1, (a.stamina ?? 1) - amt));
};

// 타격 스텝 — 스윙 순간 몸을 컨택 지점 쪽으로 붙인다 (라켓·셔틀이 떨어져 보이는
// '치는 모션 부정확' 해소). 리치 안 거리의 70%를 즉시 좁힌다.
function stepIntoShot(a: Actor, cx: number, cy: number, yMin: number, yMax: number): void {
  a.x += Math.max(-0.6, Math.min(0.6, (cx - a.x) * 0.7));
  a.y = Math.min(yMax, Math.max(yMin, a.y + Math.max(-0.45, Math.min(0.45, (cy - a.y) * 0.7))));
}

// ─── 상태 생성 ─────────────────────────────────────────────────────
export function createSim(config: MatchConfig): SimState {
  return {
    clock: 0,
    phase: 'serve',
    config,
    score: { player: 0, ai: 0 },
    server: 'player',
    rallyLen: 0,
    deuce: false,
    player: { x: 1.2, y: -3.2, anim: 'idle', animUntil: 0, moving: false, facing: 1, stamina: 1 },
    ai: { x: -1.2, y: 3.2, anim: 'idle', animUntil: 0, moving: false, facing: -1, stamina: 1 },
    shuttle: { x: 1.2, y: -3.0, z: 1.0 },
    traj: null,
    banner: null,
    bannerUntil: 0,
    aiServeAt: 0,
    winner: null,
    stats: { longestRally: 0, perfects: 0 },
    lastShot: null,
    events: [],
  };
}

// ─── 궤적 ──────────────────────────────────────────────────────────
function bezier(t: Traj, u: number): Vec3 {
  const v = 1 - u;
  return {
    x: v * v * t.p0.x + 2 * v * u * t.c.x + u * u * t.p2.x,
    y: v * v * t.p0.y + 2 * v * u * t.c.y + u * u * t.p2.y,
    z: v * v * t.p0.z + 2 * v * u * t.c.z + u * u * t.p2.z,
  };
}

// 셔틀 특유의 급감속 — 빠르게 출발해 목표 근처에서 죽는다 (스매시는 직선 유지)
function easeU(shot: ShotType, u: number): number {
  if (shot === 'smash') return u;
  return 1 - Math.pow(1 - u, 1.45);
}

// 네트 클리어런스 — '인' 판정 궤적은 시각적으로도 반드시 네트를 넘게 보정.
// 커브가 y=0(네트)에서 테이프(1.55m)보다 낮게 지나면 정점(c.z)을 끌어올린다.
// 이게 없으면 낮은 스매시/드라이브가 네트를 '뚫고' 지나가는 것처럼 그려진다.
function clearNet(t: Traj): void {
  if (t.landing === 'net') return; // 네트에 꽂히는 샷은 그대로
  if (Math.sign(t.p0.y || 0.01) === Math.sign(t.p2.y || -0.01)) return;
  for (let iter = 0; iter < 3; iter++) {
    // y(u)=0 근처의 u를 샘플링으로 찾는다
    let bestU = 0.5;
    let bestAbs = Infinity;
    for (let i = 1; i < 24; i++) {
      const u = i / 24;
      const v = 1 - u;
      const y = v * v * t.p0.y + 2 * v * u * t.c.y + u * u * t.p2.y;
      const a = Math.abs(y);
      if (a < bestAbs) { bestAbs = a; bestU = u; }
    }
    const u = bestU;
    const v = 1 - u;
    const z = v * v * t.p0.z + 2 * v * u * t.c.z + u * u * t.p2.z;
    const need = 1.66; // 테이프 + 셔틀 반경 여유
    if (z >= need) return;
    t.c.z += (need - z) / Math.max(0.2, 2 * u * v);
  }
}

function makeTraj(
  by: Side,
  shot: ShotType,
  quality: Quality,
  from: Vec3,
  aimX: number,
  now: number,
  rallyLen = 0,
  pace = 1,
  depth: AimDepth = 0,
  punish = false,
  stretchSafe = false, // 밀린 발(런지) 리턴 — 실수 대신 뜬공(수비 리턴) 위주
): Traj {
  const spec = SHOT3[shot];
  const dir = by === 'player' ? 1 : -1; // 목표 y 부호
  // 랠리 가속은 완만하게 — 판은 끝나되 랠리가 만들어질 시간을 남긴다
  let dur = spec.dur * Math.max(0.8, 1 - rallyLen * 0.008) * pace;
  let chance = false;
  let landing: Traj['landing'] = 'in';

  // 깊이 코스 — 샷 고유 사거리 안에서 앞/뒤 1/3 구간을 노린다
  const span = spec.yMax - spec.yMin;
  let ty =
    depth > 0 ? dir * rnd(spec.yMin + span * 0.62, spec.yMax)
    : depth < 0 ? dir * rnd(spec.yMin, spec.yMin + span * 0.38)
    : dir * rnd(spec.yMin, spec.yMax);
  // 좌우 코스 — 연속값. 풀 틸트(≈2.3m)는 사이드라인 근처 = 퍼펙트가 아니면 리스크
  let tx = aimX * 2.6 + rnd(-0.3, 0.3) * (quality === 'perfect' ? 0.55 : 1);
  if (Math.abs(aimX) > 0.85 && quality !== 'perfect') tx += rnd(-0.35, 0.35); // 라인 노림 흔들림
  let apex = spec.apex;

  if (punish && shot === 'smash' && quality !== 'bad') {
    dur *= 0.86; // 뜬공 응징 — 더 빠르고
    ty = dir * rnd(1.7, 2.9); // 더 가파르게 꽂힌다
  }
  if (quality === 'perfect') {
    if (shot === 'smash') dur *= 0.85;
    // 깊이를 직접 지정하지 않았을 때만 퍼펙트 기본 코스(깊은 클리어·타이트 드롭)로 벼린다
    if (depth === 0) {
      if (shot === 'clear' || shot === 'lift') ty = dir * rnd(5.6, 6.4);
      if (shot === 'drop') ty = dir * rnd(0.7, 1.2);
    }
    if (shot === 'hairpin') {
      ty = dir * rnd(0.35, 0.7);
      apex = 1.72; // 네트를 스친다
    }
  } else if (quality === 'bad') {
    if (shot === 'smash') {
      // 밀렸거나 타점이 낮은 스매시 — 힘이 안 실려 대부분 뜬다
      const r = Math.random();
      if (r < 0.6) {
        ty = dir * rnd(2.0, 3.2);
        tx = rnd(-0.8, 0.8);
        apex = 3.2;
        dur = 1150;
        chance = true;
      } else if (r < 0.88) {
        ty = 0;
        apex = 1.2;
        dur = 480;
        landing = 'net';
      } else {
        ty = dir * rnd(7.0, 7.9);
        landing = 'out';
      }
    } else if ((shot === 'hairpin' || shot === 'drop' || shot === 'drive' || shot === 'block') && Math.random() < (stretchSafe ? 0.2 : 0.45)) {
      // 네트에 꽂힘
      ty = 0;
      apex = 1.2;
      landing = 'net';
      dur *= 0.6;
    } else if ((shot === 'clear' || shot === 'lift') && Math.random() < (stretchSafe ? 0.1 : 0.25)) {
      // 밀린 깊은 샷이 라인을 넘는다 — 뜬공만으로는 랠리가 영원히 안 끝난다
      ty = dir * rnd(6.9, 7.9);
      landing = 'out';
    } else {
      // 뜬공 — 느리고 높게 중앙으로, 상대 찬스
      ty = dir * rnd(2.2, 3.4);
      tx = rnd(-0.8, 0.8);
      apex = Math.max(apex, 3.4);
      dur *= 1.25;
      chance = true;
    }
  }
  // 크로스(대각) 샷 — 반대 사이드 깊숙이 보내는 각. 비행이 길어지는 대신
  // 상대를 코트 폭 끝까지 뛰게 만든다. 흔들린 크로스는 사이드라인을 넘기 쉽다.
  const cross = Math.abs(tx - from.x) > 2.6 && Math.sign(tx || 0.01) !== Math.sign(from.x || 0.01);
  if (cross) {
    dur *= 1.1;
    if (quality !== 'perfect') tx += rnd(-0.3, 0.3);
  }
  if (landing === 'in' && Math.abs(tx) > COURT.HALF_W) landing = 'out'; // 복식 라인 판정 — 코트를 넓게 쓴다

  const p2: Vec3 = { x: tx, y: ty, z: 0.02 };
  const c: Vec3 =
    shot === 'smash' && !chance
      ? { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: (from.z + 0.4) / 2 }
      : { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: Math.max(from.z, apex) + (quality === 'bad' ? 0.4 : 0) };

  const t: Traj = { by, shot, quality, chance, cross, punish: punish && shot === 'smash' && quality !== 'bad', p0: { ...from }, c, p2, t0: now, dur, landing, aiHandled: false };
  clearNet(t);
  return t;
}

// ─── 컨택트 상황 → 가능한 샷 ────────────────────────────────────────
export function contactMenu(contact: Vec3): ShotType[] {
  if (contact.z >= 1.5) return ['clear', 'smash', 'drop'];
  if (Math.abs(contact.y) <= 2.5) return ['hairpin', 'lift'];
  if (contact.z >= 0.7) return ['drive', 'lift']; // 미드코트 중간 높이 — 드라이브 구간
  return ['lift'];
}

// 플레이어의 버튼 의도 × 타점(컨택트 높이·위치) → 실제 샷.
// 메뉴로 막지 않고 타점의 인과로 푼다 — 낮은 타점 스매시도 시도는 되지만 뜬다.
function shotForContact(intent: SwingIntent, contact: Vec3): ShotType {
  const z = contact.z;
  const nearNet = Math.abs(contact.y) <= 2.5 && z < 1.5;
  if (intent === 'attack') {
    if (nearNet) return 'hairpin'; // 네트 앞 공격 = 네트 킬
    if (z >= 1.2) return 'smash';
    if (z >= 0.7) return 'drive';
    return 'lift';
  }
  if (intent === 'drop') {
    if (z >= 1.4 && !nearNet) return 'drop';
    if (nearNet) return 'hairpin';
    return 'block'; // 미드코트 낮은 타점의 커트 — 스매시 수비용 짧은 블록
  }
  if (z >= 1.3 && !nearNet) return 'clear';
  return 'lift';
}

// 타점(셔틀 높이) 퀄리티 — 샷마다 스위트 존이 다르다.
// 스매시는 높은 타점, 드라이브는 허리 높이, 헤어핀은 네트 아래 타점.
function timingQuality(shot: ShotType, z: number): 0 | 1 | 2 {
  switch (shot) {
    case 'smash':
      return z >= 1.7 && z <= 2.7 ? 2 : z >= 1.45 ? 1 : 0;
    case 'drive':
      return z >= 0.9 && z <= 1.6 ? 2 : 1;
    case 'drop':
      return z >= 1.7 ? 2 : 1;
    case 'hairpin':
      return z <= 1.25 ? 2 : 1;
    default:
      return 2; // 클리어·리프트·블록은 타점에 관대
  }
}

// 오토에임 — 상대가 없는 쪽의 '안전한' 빈 코스. 라인 노림(풀틸트)은
// 스틱을 직접 끝까지 기울였을 때만 — 오토가 라인을 긁으면 억울한 아웃이 쏟아진다
export function autoAim(s: SimState): number {
  const sign = s.ai.x > 0.5 ? -1 : s.ai.x < -0.5 ? 1 : Math.random() < 0.5 ? -1 : 1;
  return sign * rnd(0.55, 0.78);
}

// ─── 득점 처리 ─────────────────────────────────────────────────────
function pointTo(s: SimState, winner: Side, reason: string, now: number) {
  s.player.windup = false;
  s.ai.windup = false;
  s.score = { ...s.score, [winner]: s.score[winner] + 1 };
  s.stats.longestRally = Math.max(s.stats.longestRally, s.rallyLen);
  s.banner = { winner, reason };
  s.bannerUntil = now + 1500;
  s.phase = 'point';
  s.traj = null;
  s.deuce = isDeuce(s.score, s.config);
  s.events.push(`point:${winner}:${reason}:${s.score.player}-${s.score.ai}`);
}

function afterBanner(s: SimState, now: number) {
  const w = gameWinner(s.score, s.config);
  s.banner = null;
  if (w) {
    s.winner = w;
    s.phase = 'over';
    s.events.push(`over:${w}`);
    return;
  }
  const scorer: Side = s.server; // pointTo에서 server를 승자로 바꿔둔다
  s.phase = 'serve';
  s.rallyLen = 0;
  // 서브 준비 위치로 이동 목표만 잡고, 실제 이동은 tick이 처리
  if (scorer === 'ai') s.aiServeAt = now + 900;
}

// ─── 스윙(플레이어) ─────────────────────────────────────────────────
export function swingPlayer(s: SimState, intent: SwingIntent, aim: AimLane, depth: AimDepth = 0): void {
  const now = s.clock;
  // 스윙 쿨다운 — 모션이 끝나기 전 연타는 무시 (라켓이 쉼 없이 도는 것 방지)
  if ((s.player.anim === 'swing' || s.player.anim === 'lunge') && now < s.player.animUntil) return;
  if (s.phase !== 'rally' || !s.traj || s.traj.by === 'player') {
    // 칠 공이 없어도 스윙 모션은 나간다(헛스윙)
    s.player.anim = 'swing';
    s.player.animUntil = now + 300;
    s.player.motion = 'drive';
    return;
  }
  const d = dist2(s.shuttle.x, s.shuttle.y, s.player.x, s.player.y);
  const reach = REACH_BY_DIFF[s.config.difficulty];
  if (d > reach.m || s.shuttle.z > 3.0 || s.shuttle.y > 0) {
    s.player.anim = 'swing';
    s.player.animUntil = now + 300;
    s.player.motion = 'drive';
    s.lastShot = { shot: 'clear', quality: 'bad', whiff: true };
    s.events.push('whiff');
    return;
  }
  const contact: Vec3 = { ...s.shuttle };
  const wasChance = !!s.traj.chance; // 뜬공을 응징하는 스매시는 거의 못 받는다
  const distQ = d <= reach.p ? 2 : d <= reach.g ? 1 : 0;
  // 포핸드/백핸드/라운드 — 라켓 손 반대쪽 공은 약해진다 (배드민턴의 핵심 비대칭)
  const racketSign: 1 | -1 = s.leftHand ? -1 : 1;
  const hand = handFor(racketSign, contact.x - s.player.x, contact.z, distQ);
  let shot = shotForContact(intent, contact);
  // 백핸드 오버헤드: 스매시 불가(드라이브로), 파워 다운(퍼펙트 불가)
  if (hand === 'back' && contact.z >= 1.2 && shot === 'smash') shot = 'drive';
  const timeQ = timingQuality(shot, contact.z);
  // 지치면(체력<28%) 스매시 퍼펙트가 안 나온다 — 체력 운영의 이유
  const gassed = (s.player.stamina ?? 1) < 0.28 && shot === 'smash' ? 1 : 2;
  const qn = Math.min(distQ, timeQ, hand === 'back' && contact.z >= 1.5 ? 1 : 2, gassed);
  const quality: Quality = qn === 2 ? 'perfect' : qn === 1 ? 'good' : 'bad';
  let weak = quality === 'bad' ? (timeQ === 0 ? 'late' as const : 'stretch' as const) : undefined;
  // 런지(밀린 발) 리턴 — 실수 연발이 아니라 '수비 리턴': 공격 의도여도
  // 깊으면 언더클리어, 네트 근처면 블록으로 강등되고 뜬공(상대 찬스)이 된다
  if (weak === 'stretch') shot = Math.abs(contact.y) <= 2.5 ? 'block' : 'lift';
  drain(s.player, shot === 'smash' ? 0.05 : 0.015);
  const cut = shot === 'drop' && contact.z >= 1.7 && quality === 'perfect';
  const aimX = aim === 'auto' ? autoAim(s) : Math.max(-1, Math.min(1, aim));
  if (quality === 'perfect') s.stats.perfects += 1;
  s.rallyLen += 1;
  stepIntoShot(s.player, contact.x, contact.y, -6.6, -0.35);
  // 라운드는 몸이 백 쪽으로 흘러간다 — 코스 회복 페널티
  if (hand === 'round') s.player.x = Math.max(-3, Math.min(3, s.player.x - racketSign * 0.4));
  s.player.facing = racketSign; // 스윙 중엔 잡이 손 고정 — 미러로 손이 바뀌지 않게
  s.player.anim = quality === 'bad' ? 'lunge' : 'swing';
  s.player.animUntil = now + 260;
  s.player.motion = motionForHand(motionFor(shot), hand);
  s.traj = makeTraj('player', shot, quality, contact, aimX, now, s.rallyLen, DIFF_PACE[s.config.difficulty], depth, wasChance, weak === 'stretch');
  s.lastShot = { shot, quality, cross: s.traj.cross, cut, weak, hand };
  s.events.push(`swing:${shot}:${quality}:${hand}${s.traj.cross ? ':cross' : ''}${weak ? `:${weak}` : ''}:z${contact.z.toFixed(2)}:d${d.toFixed(2)}`);
}

// ─── 서브 ──────────────────────────────────────────────────────────
// 대각선 서비스 박스로만 나간다. 배드 서브는 35% 확률로 폴트(네트/롱).
function makeServeTraj(
  by: Side,
  kind: ServeKind,
  quality: Quality,
  from: Vec3,
  targetSign: 1 | -1,
  now: number,
  pace = 1,
): Traj {
  const dir = by === 'player' ? 1 : -1;
  let landing: Traj['landing'] = 'in';
  let chance = false;
  let tx = targetSign * rnd(0.7, 2.3);
  let dur: number, apex: number, ty: number;
  if (kind === 'short') {
    dur = 1100;
    apex = quality === 'perfect' ? 1.72 : 1.95; // 퍼펙트 숏서브는 네트를 스친다
    ty = dir * rnd(2.05, 2.7);
  } else if (kind === 'flick') {
    // 플릭: 숏서브인 척하다 마지막에 튕겨 깊게 — 빠르고 낮은 궤적
    dur = 980;
    apex = quality === 'perfect' ? 2.3 : 2.7;
    ty = dir * (quality === 'perfect' ? rnd(5.2, 6.0) : rnd(4.5, 5.6));
  } else {
    dur = 1600;
    apex = 4.8;
    ty = dir * (quality === 'perfect' ? rnd(5.7, 6.4) : rnd(4.7, 6.0));
  }
  dur *= pace;
  if (quality === 'bad') {
    if (Math.random() < 0.35) {
      // 서비스 폴트
      if (kind === 'short') {
        ty = 0;
        apex = 1.2;
        dur = 620;
        landing = 'net';
      } else {
        ty = dir * rnd(7.0, 7.8);
        landing = 'out';
      }
    } else {
      // 어설픈 서브 — 짧고 높게 떠서 상대 찬스 (플릭 실패는 특히 위험)
      ty = dir * rnd(2.6, 3.4);
      apex = Math.max(apex, 3.6);
      dur *= 1.12;
      chance = true;
    }
  }
  const p2: Vec3 = { x: tx, y: ty, z: 0.02 };
  const c: Vec3 = { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: apex };
  const shot: ShotType = kind === 'short' ? 'hairpin' : kind === 'flick' ? 'drive' : 'lift';
  const t: Traj = { by, shot, quality, chance, serve: true, p0: { ...from }, c, p2, t0: now, dur, landing, aiHandled: false };
  clearNet(t);
  return t;
}

export function servePlayer(s: SimState, kind: ServeKind, gaugePhase: number): void {
  const now = s.clock;
  if (s.phase !== 'serve' || s.server !== 'player') return;
  const quality: Quality = gaugePhase > 0.92 ? 'perfect' : gaugePhase > 0.65 ? 'good' : 'bad';
  const spots = serveSpots(s);
  const from: Vec3 = { x: s.player.x, y: s.player.y, z: 0.9 };
  s.phase = 'rally';
  s.lastShot = { shot: kind === 'short' ? 'hairpin' : kind === 'flick' ? 'drive' : 'clear', quality, serve: true };
  s.player.anim = 'swing';
  s.player.animUntil = now + 240;
  s.player.motion = kind === 'long' ? 'under' : 'netPush'; // 플릭은 숏서브와 같은 모션 — 속임수
  s.traj = makeServeTraj('player', kind, quality, from, spots.targetSign, now, DIFF_PACE[s.config.difficulty]);
  s.events.push(`serve:${kind}:${quality}`);
}

function serveAi(s: SimState, now: number) {
  // 서브 심리전 — 난이도 높을수록 플릭 기습 비중 상승
  const flickP = s.config.difficulty === 'hard' ? 0.3 : s.config.difficulty === 'normal' ? 0.22 : 0.08;
  const r = Math.random();
  const kind: ServeKind = r < flickP ? 'flick' : r < flickP + 0.4 ? 'long' : 'short';
  const lo = s.config.difficulty === 'hard' ? 0.75 : s.config.difficulty === 'normal' ? 0.56 : 0.4;
  const phase = lo + Math.random() * (1 - lo);
  const quality: Quality = phase > 0.92 ? 'perfect' : phase > 0.65 ? 'good' : 'bad';
  const spots = serveSpots(s);
  const from: Vec3 = { x: s.ai.x, y: s.ai.y, z: 0.9 };
  s.phase = 'rally';
  s.ai.anim = 'swing';
  s.ai.animUntil = now + 240;
  s.ai.motion = kind === 'long' ? 'under' : 'netPush';
  s.traj = makeServeTraj('ai', kind, quality, from, spots.targetSign, now, DIFF_PACE[s.config.difficulty]);
  s.events.push(`ai-serve:${kind}:${quality}`);
}

// ─── AI 스윙 ───────────────────────────────────────────────────────
function aiSwing(s: SimState, now: number) {
  const t = s.traj!;
  const d = dist2(s.shuttle.x, s.shuttle.y, s.ai.x, s.ai.y);
  const [p, g] = AI_Q[s.config.difficulty];
  const fatigue = (1 - (s.ai.stamina ?? 1)) * 0.16; // 지친 만큼 실수가 는다
  const roll = Math.random();
  let quality: Quality = roll < p ? 'perfect' : roll < p + g - fatigue ? 'good' : 'bad';
  const aiStretch = d > REACH_GOOD;
  if (aiStretch) quality = 'bad'; // 런지 리턴 — 수비적 뜬공
  if (t.chance && quality === 'bad' && s.config.difficulty !== 'easy') quality = 'good'; // 뜬공 구제 — easy는 찬스도 놓친다

  const contact: Vec3 = { ...s.shuttle };
  // AI(정면 뷰)의 라켓 방향 = 월드 -x. 백핸드 하이는 AI도 약해진다
  const aiHand = handFor(-1, contact.x - s.ai.x, contact.z, d <= REACH_PERFECT ? 2 : d <= REACH_GOOD ? 1 : 0);
  if (aiHand === 'back' && contact.z >= 1.5 && quality === 'perfect') quality = 'good';
  // 스매시 리시브는 카운터가 아니라 버티는 수비 — 퀄리티 하향, 응징 스매시는 절반이 배드
  if (t.shot === 'smash') {
    if (quality === 'perfect') quality = 'good';
    if (t.punish && Math.random() < 0.5) quality = 'bad';
  }
  const menu = contactMenu(contact);
  let shot: ShotType;
  if (menu.includes('smash') && (t.chance || Math.random() < (s.config.difficulty === 'hard' ? 0.5 : s.config.difficulty === 'normal' ? 0.3 : 0.16))) {
    shot = 'smash';
  } else if (menu.includes('drive') && Math.random() < 0.55) shot = 'drive';
  else if (menu.includes('drop') && Math.random() < 0.35) shot = 'drop';
  else if (menu.includes('hairpin') && Math.random() < 0.5) shot = 'hairpin';
  else shot = menu.includes('clear') ? 'clear' : 'lift';

  // 코스: 플레이어가 없는 쪽을 연속값으로 노린다 (난이도가 높을수록 독하고 와이드하게)
  const openSign = s.player.x > 0.6 ? -1 : s.player.x < -0.6 ? 1 : Math.random() < 0.5 ? -1 : 1;
  const smart = Math.random() < (s.config.difficulty === 'hard' ? 0.85 : s.config.difficulty === 'normal' ? 0.55 : 0.28);
  let aim = smart ? openSign * rnd(0.5, s.config.difficulty === 'hard' ? 0.95 : 0.75) : rnd(-0.7, 0.7);
  // 깊이도 섞는다 — 플레이어가 뒤에 있으면 짧게, 앞에 있으면 깊게 노리는 경향
  let depth: AimDepth = smart
    ? (Math.abs(s.player.y) > 4.4 ? -1 : Math.abs(s.player.y) < 2.6 ? 1 : 0)
    : ((Math.round(rnd(-1, 1)) as AimDepth));
  // 배드민턴 공략: 상대 백핸드 하이 코스 노리기 (normal 15% / hard 30%)
  const bhProb = s.config.difficulty === 'hard' ? 0.3 : s.config.difficulty === 'normal' ? 0.08 : 0;
  if ((shot === 'clear' || shot === 'lift' || shot === 'drive') && Math.random() < bhProb) {
    aim = (s.leftHand ? 1 : -1) * rnd(0.5, 0.9);
    depth = 1;
  }

  s.rallyLen += 1;
  stepIntoShot(s.ai, contact.x, contact.y, 0.35, 6.6);
  drain(s.ai, shot === 'smash' ? 0.05 : 0.015);
  s.ai.facing = -1;
  s.ai.anim = quality === 'bad' ? 'lunge' : 'swing';
  s.ai.animUntil = now + 260;
  s.ai.motion = motionForHand(motionFor(shot), aiHand);
  const aiPunish = t.chance && s.config.difficulty !== 'easy';
  s.traj = makeTraj('ai', shot, quality, contact, aim, now, s.rallyLen, DIFF_PACE[s.config.difficulty], depth, aiPunish, aiStretch);
  s.events.push(`ai-swing:${shot}:${quality}:${aiHand}`);
}

// ─── 메인 틱 ───────────────────────────────────────────────────────
export interface MoveInput {
  dx: number; // -1..1 (화면 오른쪽 +)
  dy: number; // -1..1 (화면 위쪽 + = 네트 방향)
}

export function tick(s: SimState, dtMs: number, input: MoveInput, remote?: MoveInput): void {
  const stepMs = Math.min(dtMs, 50);
  s.clock += stepMs;
  const now = s.clock;
  const dt = stepMs / 1000;

  // 체력 회복 — 포인트 사이·서브 대기에 크게, 랠리 중 멈춰 있으면 조금
  if (s.phase === 'point' || s.phase === 'serve') {
    drain(s.player, -0.12 * dt);
    drain(s.ai, -0.12 * dt);
  } else if (s.phase === 'rally') {
    if (!s.player.moving) drain(s.player, -0.015 * dt);
    if (!s.ai.moving) drain(s.ai, -0.015 * dt);
  }

  // 플레이어 이동 — 서브 준비 중에는 규정 위치에 묶인다(조이스틱 무시)
  const mag = Math.hypot(input.dx, input.dy);
  if (mag > 0.15 && s.phase !== 'over' && s.phase !== 'serve') {
    const nx = input.dx / Math.max(1, mag);
    const ny = input.dy / Math.max(1, mag);
    const psp = PLAYER_SPEED * spMult(s.player.stamina);
    s.player.x = Math.min(3.0, Math.max(-3.0, s.player.x + nx * psp * dt));
    s.player.y = Math.min(-0.35, Math.max(-6.6, s.player.y + ny * psp * dt));
    s.player.moving = true;
    drain(s.player, psp * dt * 0.012);
    if (Math.abs(nx) > 0.2) s.player.facing = nx > 0 ? 1 : -1;
  } else {
    s.player.moving = false;
  }

  // PvP: 원격(게스트) 조이스틱이 s.ai를 조종 — 월드 프레임으로 이미 반전돼 들어온다
  if (s.pvp && remote) {
    const rm = Math.hypot(remote.dx, remote.dy);
    if (rm > 0.15 && s.phase === 'rally') {
      const nx = remote.dx / Math.max(1, rm);
      const ny = remote.dy / Math.max(1, rm);
      const rsp = PLAYER_SPEED * spMult(s.ai.stamina);
      s.ai.x = Math.min(3.0, Math.max(-3.0, s.ai.x + nx * rsp * dt));
      s.ai.y = Math.min(6.6, Math.max(0.35, s.ai.y + ny * rsp * dt));
      s.ai.moving = true;
      drain(s.ai, rsp * dt * 0.012);
      if (Math.abs(nx) > 0.2) s.ai.facing = nx > 0 ? 1 : -1;
    } else if (s.phase === 'rally') {
      s.ai.moving = false;
    }
  }
  if (s.player.anim !== 'idle' && now > s.player.animUntil) s.player.anim = 'idle';
  if (s.ai.anim !== 'idle' && now > s.ai.animUntil) s.ai.anim = 'idle';

  // 배너/서브 대기
  if (s.phase === 'point' && now >= s.bannerUntil) afterBanner(s, now);
  if (s.phase === 'serve') {
    // 둘 다 규정 서비스 코트로 정렬 (짝수=우측, 홀수=좌측, 리시버는 대각선 박스)
    const spots = serveSpots(s);
    const aiSp = AI_SPEED[s.config.difficulty];
    if (s.server === 'player') {
      moveActor(s.player, spots.server.x, spots.server.y, PLAYER_SPEED, dt);
      moveActor(s.ai, spots.receiver.x, spots.receiver.y, aiSp, dt);
    } else {
      moveActor(s.ai, spots.server.x, spots.server.y, aiSp, dt);
      moveActor(s.player, spots.receiver.x, spots.receiver.y, PLAYER_SPEED, dt);
    }
    s.shuttle = s.server === 'player'
      ? { x: s.player.x, y: s.player.y - 0.15, z: 0.95 }
      : { x: s.ai.x, y: s.ai.y + 0.15, z: 0.95 };
    if (!s.pvp && s.server === 'ai' && s.aiServeAt > 0 && now >= s.aiServeAt) {
      s.aiServeAt = 0;
      serveAi(s, now);
    }
    return;
  }
  if (s.phase !== 'rally' || !s.traj) return;

  // 셔틀 비행
  const t = s.traj;
  const u = Math.min(1, (now - t.t0) / t.dur);
  s.shuttle = bezier(t, easeU(t.shot, u));

  // 백스윙 준비 — 오는 공이 절반쯤 넘어오면 받을 쪽이 라켓을 미리 젖힌다
  s.player.windup = t.by === 'ai' && u > 0.45 && s.player.anim === 'idle';
  s.ai.windup = t.by === 'player' && u > 0.5 && s.ai.anim === 'idle';

  // AI 이동: 내 샷이면 낙하점으로, 아니면 홈으로 (PvP에선 원격 입력이 조종)
  if (s.pvp) {
    // 원격 스윙 판정은 swingRemote가 처리 — 여기선 자동 행동 없음
  } else if (t.by === 'player') {
    const def = SMASH_DEF[s.config.difficulty];
    const smashDef = t.shot === 'smash';
    // 스매시는 반응 지연 — 빠른 공엔 늦게 출발한다 (응징 스매시는 더 늦게)
    const reactU = smashDef ? (t.punish ? def.react + 0.14 : def.react) : 0;
    if (u >= reactU) {
      const target = t.landing === 'in' ? t.p2 : { x: 0, y: 3.2, z: 0 }; // 아웃 코스는 지켜본다
      const mv = moveActor(s.ai, target.x, Math.max(0.4, target.y), AI_SPEED[s.config.difficulty] * spMult(s.ai.stamina), dt);
      drain(s.ai, mv * 0.005);
    }
    // AI 스윙 판정 — 스매시는 캐치 반경 축소 (응징이면 거의 못 받는다)
    if (!t.aiHandled && u > 0.5 && s.shuttle.z < 2.8 && s.shuttle.y > 0) {
      const d = dist2(s.shuttle.x, s.shuttle.y, s.ai.x, s.ai.y);
      const catchR = REACH_GOOD * (smashDef ? (t.punish ? def.punishR : def.catchR) : 1);
      if (d < catchR) {
        t.aiHandled = true;
        if (t.landing === 'in') aiSwing(s, now);
      } else if (u > 0.82 && d < REACH_MAX * (smashDef ? 0.75 : 1)) {
        // 겨우 닿는 런지 — 스매시 수비는 더 자주 빗나간다
        t.aiHandled = true;
        const whiffBase = s.config.difficulty === 'hard' ? 0.3 : s.config.difficulty === 'normal' ? 0.5 : 0.58;
        const whiffP = whiffBase + (smashDef ? (t.punish ? 0.35 : 0.2) : 0);
        if (Math.random() < whiffP) {
          s.ai.anim = 'lunge';
          s.ai.animUntil = now + 300;
          s.events.push('ai-whiff');
        } else if (t.landing === 'in') {
          aiSwing(s, now);
        }
      }
    }
  } else {
    // 스매시 후엔 전진(넷대시) — 짧은 블록 리턴을 푸시로 마무리하러 들어간다
    const homeY = t.shot === 'smash' ? 2.0 : 3.0;
    const mv = moveActor(s.ai, 0, homeY, AI_SPEED[s.config.difficulty] * spMult(s.ai.stamina), dt);
    drain(s.ai, mv * 0.005);
  }

  // 착지 판정
  if (u >= 1) {
    const hitter = t.by;
    const receiver: Side = hitter === 'player' ? 'ai' : 'player';
    if (t.landing === 'net') {
      s.server = receiver;
      pointTo(s, receiver, t.serve ? '서비스 폴트!' : '네트!', now);
    } else if (t.landing === 'out') {
      s.server = receiver;
      pointTo(s, receiver, t.serve ? '서비스 폴트!' : '아웃!', now);
    } else {
      s.server = hitter;
      // PvP는 양쪽 다 사람 — 중립 문구('위너!')로 두고 배너 서브라인이 시점을 붙인다
      pointTo(s, hitter, s.pvp || hitter === 'player' ? '위너!' : '실점 — 못 받았어요', now);
    }
  }
}

function moveActor(a: Actor, tx: number, ty: number, sp: number, dt: number): number {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) {
    a.moving = false;
    return 0;
  }
  const step = Math.min(d, sp * dt);
  a.x += (dx / d) * step;
  a.y += (dy / d) * step;
  a.moving = true;
  if (Math.abs(dx) > 0.1) a.facing = dx > 0 ? 1 : -1;
  return step;
}

// ═══ PvP (호스트 권위) ══════════════════════════════════════════════
// 호스트만 이 sim을 돌린다. 게스트의 스윙/서브는 아래 *Remote 함수로
// s.ai 액터에 적용되고(랜덤은 호스트에서만 굴러 권위 일원화),
// 게스트 화면은 makeSnapshot이 만든 '게스트 프레임 미러'를 그대로 그린다 —
// 게스트 입장에선 자기가 player(근경), 호스트가 ai(원경)로 뒤집혀 온다.

// 원격(게스트) 오토에임 — 호스트 플레이어가 없는 쪽의 안전한 코스
function autoAimRemote(s: SimState): number {
  const sign = s.player.x > 0.5 ? -1 : s.player.x < -0.5 ? 1 : Math.random() < 0.5 ? -1 : 1;
  return sign * rnd(0.55, 0.78);
}

/** 게스트 스윙을 호스트 sim의 ai 액터에 적용. aim은 이미 월드 프레임(부호 반전 완료). */
export function swingRemote(s: SimState, intent: SwingIntent, aim: AimLane, depth: AimDepth = 0): void {
  const now = s.clock;
  // 스윙 쿨다운 — 연타 무시 (플레이어와 동일 규칙)
  if ((s.ai.anim === 'swing' || s.ai.anim === 'lunge') && now < s.ai.animUntil) return;
  if (s.phase !== 'rally' || !s.traj || s.traj.by === 'ai') {
    s.ai.anim = 'swing';
    s.ai.animUntil = now + 300;
    s.ai.motion = 'drive';
    return;
  }
  const d = dist2(s.shuttle.x, s.shuttle.y, s.ai.x, s.ai.y);
  const reach = REACH_BY_DIFF[s.config.difficulty];
  if (d > reach.m || s.shuttle.z > 3.0 || s.shuttle.y < 0) {
    s.ai.anim = 'swing';
    s.ai.animUntil = now + 300;
    s.ai.motion = 'drive';
    s.lastShot = { shot: 'clear', quality: 'bad', whiff: true, by: 'ai' };
    s.events.push('remote-whiff');
    return;
  }
  const contact: Vec3 = { ...s.shuttle };
  const wasChance = !!s.traj.chance;
  const distQ = d <= reach.p ? 2 : d <= reach.g ? 1 : 0;
  // 게스트 손잡이 반영 — 오른손잡이 게스트의 라켓 방향 = 월드 -x
  const remoteSign: 1 | -1 = s.remoteLeftHand ? 1 : -1;
  const hand = handFor(remoteSign, contact.x - s.ai.x, contact.z, distQ);
  let shot = shotForContact(intent, contact);
  if (hand === 'back' && contact.z >= 1.2 && shot === 'smash') shot = 'drive';
  const timeQ = timingQuality(shot, contact.z);
  const qn = Math.min(distQ, timeQ, hand === 'back' && contact.z >= 1.5 ? 1 : 2);
  const quality: Quality = qn === 2 ? 'perfect' : qn === 1 ? 'good' : 'bad';
  let weak = quality === 'bad' ? (timeQ === 0 ? 'late' as const : 'stretch' as const) : undefined;
  if (weak === 'stretch') shot = Math.abs(contact.y) <= 2.5 ? 'block' : 'lift';
  const cut = shot === 'drop' && contact.z >= 1.7 && quality === 'perfect';
  const aimX = aim === 'auto' ? autoAimRemote(s) : Math.max(-1, Math.min(1, aim));
  if (quality === 'perfect') s.stats.perfectsRemote = (s.stats.perfectsRemote ?? 0) + 1;
  s.rallyLen += 1;
  stepIntoShot(s.ai, contact.x, contact.y, 0.35, 6.6);
  drain(s.ai, shot === 'smash' ? 0.05 : 0.015);
  s.ai.facing = remoteSign;
  s.ai.anim = quality === 'bad' ? 'lunge' : 'swing';
  s.ai.animUntil = now + 260;
  s.ai.motion = motionForHand(motionFor(shot), hand);
  s.traj = makeTraj('ai', shot, quality, contact, aimX, now, s.rallyLen, DIFF_PACE[s.config.difficulty], depth, wasChance, weak === 'stretch');
  s.lastShot = { shot, quality, cross: s.traj.cross, cut, weak, by: 'ai', hand };
  s.events.push(`remote-swing:${shot}:${quality}:${hand}`);
}

/** 게스트 서브를 호스트 sim에 적용 — 게이지 위상은 게스트 화면에서 잰 값. */
export function serveRemote(s: SimState, kind: ServeKind, gaugePhase: number): void {
  const now = s.clock;
  if (s.phase !== 'serve' || s.server !== 'ai') return;
  const quality: Quality = gaugePhase > 0.92 ? 'perfect' : gaugePhase > 0.65 ? 'good' : 'bad';
  const spots = serveSpots(s);
  const from: Vec3 = { x: s.ai.x, y: s.ai.y, z: 0.9 };
  s.phase = 'rally';
  s.aiServeAt = 0;
  s.lastShot = { shot: kind === 'short' ? 'hairpin' : kind === 'flick' ? 'drive' : 'clear', quality, serve: true, by: 'ai' };
  s.ai.anim = 'swing';
  s.ai.animUntil = now + 240;
  s.ai.motion = kind === 'long' ? 'under' : 'netPush';
  s.traj = makeServeTraj('ai', kind, quality, from, spots.targetSign, now, DIFF_PACE[s.config.difficulty]);
  s.events.push(`remote-serve:${kind}:${quality}`);
}

// ─── 스냅샷 미러 — 호스트 월드 → 게스트 프레임(x·y 반전 + 역할 스왑) ───
export interface NetSnapshot {
  clock: number;
  phase: SimPhase;
  score: Score;
  server: Side;
  rallyLen: number;
  deuce: boolean;
  winner: Side | null;
  banner: { winner: Side; reason: string } | null;
  bannerUntil: number;
  player: Actor;
  ai: Actor;
  shuttle: Vec3;
  traj: Traj | null;
  stats: { longestRally: number; perfects: number };
  lastShot: SimState['lastShot'];
}

const flipSide = (side: Side): Side => (side === 'player' ? 'ai' : 'player');
const mirrorActor = (a: Actor): Actor => ({ ...a, x: -a.x, y: -a.y, facing: (a.facing * -1) as 1 | -1 });
const mirrorVec = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: v.z });

export function makeSnapshot(s: SimState): NetSnapshot {
  return {
    clock: s.clock,
    phase: s.phase,
    score: { player: s.score.ai, ai: s.score.player },
    server: flipSide(s.server),
    rallyLen: s.rallyLen,
    deuce: s.deuce,
    winner: s.winner ? flipSide(s.winner) : null,
    banner: s.banner ? { winner: flipSide(s.banner.winner), reason: s.banner.reason } : null,
    bannerUntil: s.bannerUntil,
    player: mirrorActor(s.ai),
    ai: mirrorActor(s.player),
    shuttle: mirrorVec(s.shuttle),
    traj: s.traj
      ? { ...s.traj, by: flipSide(s.traj.by), p0: mirrorVec(s.traj.p0), c: mirrorVec(s.traj.c), p2: mirrorVec(s.traj.p2) }
      : null,
    stats: { longestRally: s.stats.longestRally, perfects: s.stats.perfectsRemote ?? 0 },
    lastShot: s.lastShot ? { ...s.lastShot, by: flipSide(s.lastShot.by ?? 'player') } : null,
  };
}

/** 게스트: 스냅샷 적용. 내 캐릭터(로컬 예측)는 살짝만 보정하고 크게 어긋나면 스냅. */
export function applySnapshot(s: SimState, snap: NetSnapshot): void {
  // 클록: 지연 때문에 스냅샷 클록이 약간 뒤처져 온다 — 완만히 수렴, 큰 차이만 스냅
  const cd = snap.clock - s.clock;
  if (Math.abs(cd) > 150) s.clock = snap.clock;
  else s.clock += cd * 0.12;
  s.phase = snap.phase;
  s.score = snap.score;
  s.server = snap.server;
  s.rallyLen = snap.rallyLen;
  s.deuce = snap.deuce;
  s.winner = snap.winner;
  s.banner = snap.banner;
  s.bannerUntil = snap.bannerUntil;
  s.shuttle = snap.shuttle;
  s.traj = snap.traj;
  s.stats = { ...s.stats, ...snap.stats };
  s.lastShot = snap.lastShot;
  // 내 캐릭터: 위치는 로컬 예측 우선(소프트 보정), lunge 같은 판정 모션만 수용
  const err = Math.hypot(snap.player.x - s.player.x, snap.player.y - s.player.y);
  if (err > 1.2) {
    s.player.x = snap.player.x;
    s.player.y = snap.player.y;
  } else {
    s.player.x += (snap.player.x - s.player.x) * 0.2;
    s.player.y += (snap.player.y - s.player.y) * 0.2;
  }
  if (snap.player.anim === 'lunge') {
    s.player.anim = 'lunge';
    s.player.animUntil = snap.player.animUntil;
  }
  s.player.windup = snap.player.windup; // 백스윙 준비 신호도 미러
  s.player.stamina = snap.player.stamina; // 체력은 호스트 권위
  // 상대 캐릭터: 목표만 갱신 — 실제 이동은 guestTick이 보간(12Hz 점프 방지)
  s.ai.anim = snap.ai.anim;
  s.ai.animUntil = snap.ai.animUntil;
  s.ai.facing = snap.ai.facing;
  s.ai.moving = snap.ai.moving;
  s.ai.motion = snap.ai.motion; // 상대 스윙 클립 — 게스트 화면 모션 재생용
  s.ai.windup = snap.ai.windup;
  s.ai.stamina = snap.ai.stamina;
}

/** 게스트 프레임 렌더 틱 — sim 없이 이동 예측 + 셔틀 비행 + 서브 정렬만. */
export function guestTick(
  s: SimState,
  dtMs: number,
  input: MoveInput,
  oppTarget: { x: number; y: number } | null,
): void {
  const stepMs = Math.min(dtMs, 50);
  s.clock += stepMs;
  const now = s.clock;
  const dt = stepMs / 1000;

  // 내 이동(로컬 예측) — 랠리 중에만, 서브 중엔 규정 위치 고정
  const mag = Math.hypot(input.dx, input.dy);
  if (mag > 0.15 && s.phase === 'rally') {
    const nx = input.dx / Math.max(1, mag);
    const ny = input.dy / Math.max(1, mag);
    s.player.x = Math.min(3.0, Math.max(-3.0, s.player.x + nx * PLAYER_SPEED * dt));
    s.player.y = Math.min(-0.35, Math.max(-6.6, s.player.y + ny * PLAYER_SPEED * dt));
    s.player.moving = true;
    if (Math.abs(nx) > 0.2) s.player.facing = nx > 0 ? 1 : -1;
  } else {
    s.player.moving = false;
  }
  if (s.player.anim !== 'idle' && now > s.player.animUntil) s.player.anim = 'idle';
  if (s.ai.anim !== 'idle' && now > s.ai.animUntil) s.ai.anim = 'idle';

  // 상대: 스냅샷 목표로 보간
  if (oppTarget) moveActor(s.ai, oppTarget.x, oppTarget.y, PLAYER_SPEED * 1.35, dt);

  if (s.phase === 'serve') {
    const spots = serveSpots(s);
    const mine = s.server === 'player' ? spots.server : spots.receiver;
    moveActor(s.player, mine.x, mine.y, PLAYER_SPEED, dt);
    s.shuttle = s.server === 'player'
      ? { x: s.player.x, y: s.player.y - 0.15, z: 0.95 }
      : { x: s.ai.x, y: s.ai.y + 0.15, z: 0.95 };
    return;
  }
  // 셔틀 비행 — traj는 게스트 프레임으로 미러된 결정적 파라미터라 로컬 재생 가능
  if (s.phase === 'rally' && s.traj) {
    const t = s.traj;
    const u = Math.min(1, (now - t.t0) / t.dur);
    s.shuttle = bezier(t, easeU(t.shot, u));
  }
}
