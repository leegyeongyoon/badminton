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

export interface Actor {
  x: number;
  y: number;
  anim: Anim;
  animUntil: number;
  moving: boolean;
  facing: 1 | -1; // 좌우 시선(연출용)
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
}

export type SimPhase = 'serve' | 'rally' | 'point' | 'over';

export interface SimState {
  /** 시뮬레이션 자체 클록(ms) — tick이 감는다. 벽시계를 쓰지 않으므로
   *  앱이 백그라운드로 갔다 와도 셔틀이 순간이동하지 않고 그대로 일시정지된다. */
  clock: number;
  phase: SimPhase;
  config: MatchConfig;
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
  stats: { longestRally: number; perfects: number };
  lastShot: {
    shot: ShotType;
    quality: Quality;
    whiff?: boolean;
    serve?: boolean;
    cross?: boolean;
    cut?: boolean; // 높은 타점에서 자른 드롭
    weak?: 'late' | 'stretch'; // 배드의 원인 — 낮은 타점 / 밀린 발
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
export type AimLane = -1 | 0 | 1 | 'auto';

// ─── 튜닝 상수 ─────────────────────────────────────────────────────
const PLAYER_SPEED = 4.4; // m/s
const AI_SPEED: Record<Difficulty, number> = { easy: 2.9, normal: 3.6, hard: 4.4 };
const REACH_PERFECT = 0.55;
const REACH_GOOD = 0.95;
const REACH_MAX = 1.35; // 런지 한계 — 이 밖이면 헛스윙

// 샷 스펙: 비행시간(ms), 정점 높이(m), 상대 코트 목표 깊이 y 범위
const SHOT3: Record<ShotType, { dur: number; apex: number; yMin: number; yMax: number }> = {
  clear: { dur: 1350, apex: 4.6, yMin: 4.6, yMax: 6.2 },
  lift: { dur: 1500, apex: 5.2, yMin: 4.2, yMax: 6.0 },
  drop: { dur: 1050, apex: 2.7, yMin: 0.9, yMax: 1.8 },
  hairpin: { dur: 950, apex: 1.95, yMin: 0.5, yMax: 1.1 },
  block: { dur: 900, apex: 1.9, yMin: 0.8, yMax: 1.6 },
  smash: { dur: 560, apex: 0, yMin: 2.2, yMax: 3.6 }, // apex 0 = 직선 강하
  drive: { dur: 700, apex: 1.95, yMin: 3.0, yMax: 4.6 }, // 네트를 스치는 평평한 속공
};

// AI 스윙 퀄리티 분포 [perfect, good, bad]
const AI_Q: Record<Difficulty, [number, number, number]> = {
  easy: [0.15, 0.5, 0.35],
  normal: [0.3, 0.55, 0.15],
  hard: [0.45, 0.48, 0.07],
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

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
    player: { x: 1.2, y: -3.2, anim: 'idle', animUntil: 0, moving: false, facing: 1 },
    ai: { x: -1.2, y: 3.2, anim: 'idle', animUntil: 0, moving: false, facing: -1 },
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

function makeTraj(
  by: Side,
  shot: ShotType,
  quality: Quality,
  from: Vec3,
  aimX: -1 | 0 | 1,
  now: number,
  rallyLen = 0,
): Traj {
  const spec = SHOT3[shot];
  const dir = by === 'player' ? 1 : -1; // 목표 y 부호
  // 랠리 가속 — 길어질수록 샷이 빨라져 발이 못 따라가게 되고, 판은 반드시 끝난다
  let dur = spec.dur * Math.max(0.72, 1 - rallyLen * 0.012);
  let chance = false;
  let landing: Traj['landing'] = 'in';

  let ty = dir * rnd(spec.yMin, spec.yMax);
  let tx = aimX * 1.7 + rnd(-0.35, 0.35);
  let apex = spec.apex;

  if (quality === 'perfect') {
    if (shot === 'smash') dur *= 0.85;
    if (shot === 'clear' || shot === 'lift') ty = dir * rnd(5.6, 6.4);
    if (shot === 'drop') ty = dir * rnd(0.7, 1.2);
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
      } else if (r < 0.85) {
        ty = 0;
        apex = 1.2;
        dur = 480;
        landing = 'net';
      } else {
        ty = dir * rnd(7.0, 7.9);
        landing = 'out';
      }
    } else if ((shot === 'hairpin' || shot === 'drop' || shot === 'drive') && Math.random() < 0.45) {
      // 네트에 꽂힘
      ty = 0;
      apex = 1.2;
      landing = 'net';
      dur *= 0.6;
    } else if ((shot === 'clear' || shot === 'lift') && Math.random() < 0.4) {
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
  if (landing === 'in' && Math.abs(tx) > COURT.SINGLES_W) landing = 'out';

  const p2: Vec3 = { x: tx, y: ty, z: 0.02 };
  const c: Vec3 =
    shot === 'smash' && !chance
      ? { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: (from.z + 0.4) / 2 }
      : { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: Math.max(from.z, apex) + (quality === 'bad' ? 0.4 : 0) };

  return { by, shot, quality, chance, cross, p0: { ...from }, c, p2, t0: now, dur, landing, aiHandled: false };
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
    if (nearNet || z < 1.4) return 'hairpin';
    return 'lift';
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

// 오토에임 — 상대가 없는 쪽을 노린다
export function autoAim(s: SimState): -1 | 0 | 1 {
  if (s.ai.x > 0.5) return -1;
  if (s.ai.x < -0.5) return 1;
  return Math.random() < 0.5 ? -1 : 1;
}

// ─── 득점 처리 ─────────────────────────────────────────────────────
function pointTo(s: SimState, winner: Side, reason: string, now: number) {
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
export function swingPlayer(s: SimState, intent: SwingIntent, aim: AimLane): void {
  const now = s.clock;
  if (s.phase !== 'rally' || !s.traj || s.traj.by === 'player') {
    // 칠 공이 없어도 스윙 모션은 나간다(헛스윙)
    s.player.anim = 'swing';
    s.player.animUntil = now + 220;
    return;
  }
  const d = dist2(s.shuttle.x, s.shuttle.y, s.player.x, s.player.y);
  if (d > REACH_MAX || s.shuttle.z > 3.0 || s.shuttle.y > 0) {
    s.player.anim = 'swing';
    s.player.animUntil = now + 220;
    s.lastShot = { shot: 'clear', quality: 'bad', whiff: true };
    s.events.push('whiff');
    return;
  }
  const contact: Vec3 = { ...s.shuttle };
  const shot = shotForContact(intent, contact);
  // 퀄리티 = 발(거리) × 타점(높이) — 둘 중 나쁜 쪽이 결과를 정한다
  const distQ = d <= REACH_PERFECT ? 2 : d <= REACH_GOOD ? 1 : 0;
  const timeQ = timingQuality(shot, contact.z);
  const qn = Math.min(distQ, timeQ);
  const quality: Quality = qn === 2 ? 'perfect' : qn === 1 ? 'good' : 'bad';
  const weak = quality === 'bad' ? (timeQ === 0 ? 'late' as const : 'stretch' as const) : undefined;
  const cut = shot === 'drop' && contact.z >= 1.7 && quality === 'perfect';
  const aimX: -1 | 0 | 1 = aim === 'auto' ? autoAim(s) : aim;
  if (quality === 'perfect') s.stats.perfects += 1;
  s.rallyLen += 1;
  s.player.anim = quality === 'bad' ? 'lunge' : 'swing';
  s.player.animUntil = now + 260;
  s.traj = makeTraj('player', shot, quality, contact, aimX, now, s.rallyLen);
  s.lastShot = { shot, quality, cross: s.traj.cross, cut, weak };
  s.events.push(`swing:${shot}:${quality}${s.traj.cross ? ':cross' : ''}${weak ? `:${weak}` : ''}:z${contact.z.toFixed(2)}:d${d.toFixed(2)}`);
}

// ─── 서브 ──────────────────────────────────────────────────────────
// 대각선 서비스 박스로만 나간다. 배드 서브는 35% 확률로 폴트(네트/롱).
function makeServeTraj(
  by: Side,
  kind: 'short' | 'long',
  quality: Quality,
  from: Vec3,
  targetSign: 1 | -1,
  now: number,
): Traj {
  const dir = by === 'player' ? 1 : -1;
  let landing: Traj['landing'] = 'in';
  let chance = false;
  let tx = targetSign * rnd(0.7, 2.3);
  let dur: number, apex: number, ty: number;
  if (kind === 'short') {
    dur = 950;
    apex = quality === 'perfect' ? 1.72 : 1.95; // 퍼펙트 숏서브는 네트를 스친다
    ty = dir * rnd(2.05, 2.7);
  } else {
    dur = 1400;
    apex = 4.8;
    ty = dir * (quality === 'perfect' ? rnd(5.7, 6.4) : rnd(4.7, 6.0));
  }
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
      // 어설픈 서브 — 짧고 높게 떠서 상대 찬스
      ty = dir * rnd(2.6, 3.4);
      apex = Math.max(apex, 3.6);
      dur *= 1.12;
      chance = true;
    }
  }
  const p2: Vec3 = { x: tx, y: ty, z: 0.02 };
  const c: Vec3 = { x: (from.x + tx) / 2, y: (from.y + ty) / 2, z: apex };
  return { by, shot: kind === 'short' ? 'hairpin' : 'lift', quality, chance, serve: true, p0: { ...from }, c, p2, t0: now, dur, landing, aiHandled: false };
}

export function servePlayer(s: SimState, kind: 'short' | 'long', gaugePhase: number): void {
  const now = s.clock;
  if (s.phase !== 'serve' || s.server !== 'player') return;
  const quality: Quality = gaugePhase > 0.92 ? 'perfect' : gaugePhase > 0.65 ? 'good' : 'bad';
  const spots = serveSpots(s);
  const from: Vec3 = { x: s.player.x, y: s.player.y, z: 0.9 };
  s.phase = 'rally';
  s.lastShot = { shot: kind === 'short' ? 'hairpin' : 'clear', quality, serve: true };
  s.player.anim = 'swing';
  s.player.animUntil = now + 240;
  s.traj = makeServeTraj('player', kind, quality, from, spots.targetSign, now);
  s.events.push(`serve:${kind}:${quality}`);
}

function serveAi(s: SimState, now: number) {
  const kind = Math.random() < 0.55 ? 'long' : 'short';
  const lo = s.config.difficulty === 'hard' ? 0.75 : s.config.difficulty === 'normal' ? 0.62 : 0.5;
  const phase = lo + Math.random() * (1 - lo);
  const quality: Quality = phase > 0.92 ? 'perfect' : phase > 0.65 ? 'good' : 'bad';
  const spots = serveSpots(s);
  const from: Vec3 = { x: s.ai.x, y: s.ai.y, z: 0.9 };
  s.phase = 'rally';
  s.ai.anim = 'swing';
  s.ai.animUntil = now + 240;
  s.traj = makeServeTraj('ai', kind, quality, from, spots.targetSign, now);
  s.events.push(`ai-serve:${kind}:${quality}`);
}

// ─── AI 스윙 ───────────────────────────────────────────────────────
function aiSwing(s: SimState, now: number) {
  const t = s.traj!;
  const d = dist2(s.shuttle.x, s.shuttle.y, s.ai.x, s.ai.y);
  const [p, g] = AI_Q[s.config.difficulty];
  const fatigue = Math.min(0.22, s.rallyLen * 0.011); // 긴 랠리 — AI도 지친다
  const roll = Math.random();
  let quality: Quality = roll < p ? 'perfect' : roll < p + g - fatigue ? 'good' : 'bad';
  if (d > REACH_GOOD) quality = 'bad'; // 런지 리턴
  if (t.chance && quality === 'bad') quality = 'good'; // 뜬공은 살린다

  const contact: Vec3 = { ...s.shuttle };
  const menu = contactMenu(contact);
  let shot: ShotType;
  if (menu.includes('smash') && (t.chance || Math.random() < (s.config.difficulty === 'hard' ? 0.5 : 0.32))) {
    shot = 'smash';
  } else if (menu.includes('drive') && Math.random() < 0.55) shot = 'drive';
  else if (menu.includes('drop') && Math.random() < 0.35) shot = 'drop';
  else if (menu.includes('hairpin') && Math.random() < 0.5) shot = 'hairpin';
  else shot = menu.includes('clear') ? 'clear' : 'lift';

  // 코스: 플레이어가 없는 쪽을 노린다 (난이도가 높을수록 독하게)
  const open: -1 | 0 | 1 = s.player.x > 0.6 ? -1 : s.player.x < -0.6 ? 1 : Math.random() < 0.5 ? -1 : 1;
  const aim: -1 | 0 | 1 =
    Math.random() < (s.config.difficulty === 'hard' ? 0.85 : s.config.difficulty === 'normal' ? 0.65 : 0.4)
      ? open
      : ((Math.round(rnd(-1, 1)) as -1 | 0 | 1));

  s.rallyLen += 1;
  s.ai.anim = quality === 'bad' ? 'lunge' : 'swing';
  s.ai.animUntil = now + 260;
  s.traj = makeTraj('ai', shot, quality, contact, aim, now, s.rallyLen);
  s.events.push(`ai-swing:${shot}:${quality}`);
}

// ─── 메인 틱 ───────────────────────────────────────────────────────
export interface MoveInput {
  dx: number; // -1..1 (화면 오른쪽 +)
  dy: number; // -1..1 (화면 위쪽 + = 네트 방향)
}

export function tick(s: SimState, dtMs: number, input: MoveInput): void {
  const stepMs = Math.min(dtMs, 50);
  s.clock += stepMs;
  const now = s.clock;
  const dt = stepMs / 1000;

  // 플레이어 이동 — 서브 준비 중에는 규정 위치에 묶인다(조이스틱 무시)
  const mag = Math.hypot(input.dx, input.dy);
  if (mag > 0.15 && s.phase !== 'over' && s.phase !== 'serve') {
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
    if (s.server === 'ai' && s.aiServeAt > 0 && now >= s.aiServeAt) {
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

  // AI 이동: 내 샷이면 낙하점으로, 아니면 홈으로
  if (t.by === 'player') {
    const target = t.landing === 'in' ? t.p2 : { x: 0, y: 3.2, z: 0 }; // 아웃 코스는 지켜본다
    moveActor(s.ai, target.x, Math.max(0.4, target.y), AI_SPEED[s.config.difficulty], dt);
    // AI 스윙 판정
    if (!t.aiHandled && u > 0.5 && s.shuttle.z < 2.8 && s.shuttle.y > 0) {
      const d = dist2(s.shuttle.x, s.shuttle.y, s.ai.x, s.ai.y);
      if (d < REACH_GOOD) {
        t.aiHandled = true;
        if (t.landing === 'in') aiSwing(s, now);
      } else if (u > 0.82 && d < REACH_MAX) {
        // 겨우 닿는 런지 — 40%는 라켓이 빗나간다
        t.aiHandled = true;
        if (Math.random() < 0.4) {
          s.ai.anim = 'lunge';
          s.ai.animUntil = now + 300;
          s.events.push('ai-whiff');
        } else if (t.landing === 'in') {
          aiSwing(s, now);
        }
      }
    }
  } else {
    moveActor(s.ai, 0, 3.0, AI_SPEED[s.config.difficulty], dt);
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
      pointTo(s, hitter, hitter === 'player' ? '위너!' : '실점 — 못 받았어요', now);
    }
  }
}

function moveActor(a: Actor, tx: number, ty: number, sp: number, dt: number) {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) {
    a.moving = false;
    return;
  }
  const step = Math.min(d, sp * dt);
  a.x += (dx / d) * step;
  a.y += (dy / d) * step;
  a.moving = true;
  if (Math.abs(dx) > 0.1) a.facing = dx > 0 ? 1 : -1;
}
