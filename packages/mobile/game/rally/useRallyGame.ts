/**
 * 콕고 랠리 v1 — 상태머신 훅. 엔진(순수 로직)을 시간축 위에 올린다.
 * 페이즈: config → serve → (outbound ⇄ inbound)* → point → serve … → over
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flight,
  MatchConfig,
  Posture,
  Quality,
  Score,
  ShotType,
  Side,
  TimingWindows,
  Zone,
  HOME_ZONE,
  aiPosture,
  aiRespond,
  computePosture,
  gameWinner,
  isDeuce,
  judgeTiming,
  resolveServe,
  resolveShot,
  shotMenu,
  windowsFor,
} from './engine';

export type Phase = 'config' | 'serve' | 'outbound' | 'inbound' | 'point' | 'over';
export type SwingGesture = 'up' | 'down' | 'smash';

export interface RallyState {
  phase: Phase;
  config: MatchConfig;
  score: Score;
  server: Side;
  flight: Flight | null;
  flightKey: number; // 증가시켜 애니메이션 재트리거
  playerPos: Zone; // 캐릭터가 달려갈 목표 존(렌더링)
  aiPos: Zone;
  anticip: Zone | null; // 예측 스텝
  posture: Posture; // 현재 인바운드에서의 내 자세
  menu: ShotType[];
  windows: TimingWindows | null;
  arrivalAt: number; // 셔틀 도착 예정 timestamp
  rallyLen: number;
  deuce: boolean;
  banner: { winner: Side; reason: string; coerced?: boolean } | null;
  lastShot: { shot: ShotType; quality: Quality; coerced: boolean } | null;
  winner: Side | null;
  stats: { longestRally: number; perfects: number };
}

const INITIAL: RallyState = {
  phase: 'config',
  config: { target: 11, deuce: true, difficulty: 'normal' },
  score: { player: 0, ai: 0 },
  server: 'player',
  flight: null,
  flightKey: 0,
  playerPos: HOME_ZONE,
  aiPos: HOME_ZONE,
  anticip: null,
  posture: 'ready',
  menu: [],
  windows: null,
  arrivalAt: 0,
  rallyLen: 0,
  deuce: false,
  banner: null,
  lastShot: null,
  winner: null,
  stats: { longestRally: 0, perfects: 0 },
};

// score·stats는 pointTo가 제자리 갱신하므로 게임마다 새 객체여야 한다
// (INITIAL 스프레드만 쓰면 이전 판의 기록이 다음 판으로 새어 들어간다).
const freshState = (over?: Partial<RallyState>): RallyState => ({
  ...INITIAL,
  score: { player: 0, ai: 0 },
  stats: { longestRally: 0, perfects: 0 },
  ...over,
});

export function useRallyGame() {
  const s = useRef<RallyState>(freshState());
  const [snap, setSnap] = useState<RallyState>(s.current);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pub = () => setSnap({ ...s.current });
  const after = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const start = useCallback((config: MatchConfig) => {
    clearTimers();
    s.current = freshState({ config, phase: 'serve', server: 'player' });
    pub();
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    s.current = freshState();
    pub();
  }, []);

  // ── 비행 발사: 셔틀이 by → 상대 코트 toZone으로 ────────────────────
  const launch = (flight: Flight) => {
    const st = s.current;
    st.flight = flight;
    st.flightKey += 1;
    st.arrivalAt = Date.now() + flight.ms;

    if (flight.by === 'player') {
      st.phase = 'outbound';
      st.aiPos = flight.toZone; // AI가 달려간다
      pub();
      after(flight.ms, () => aiTurn(flight));
    } else {
      st.phase = 'inbound';
      const anticip = st.anticip;
      st.posture = computePosture(anticip ?? HOME_ZONE, anticip, flight);
      st.menu = shotMenu(flight.kind, st.posture);
      st.windows = windowsFor(flight, st.posture, st.config.difficulty, st.rallyLen);
      st.playerPos = flight.toZone; // 내 캐릭터가 달려간다
      pub();
      // 배드 창 끝까지 스윙이 없으면 놓친 것
      const deadline = flight.ms + st.windows.b + 40;
      const key = st.flightKey;
      after(deadline, () => {
        if (s.current.phase === 'inbound' && s.current.flightKey === key) {
          pointTo('ai', '셔틀을 놓쳤어요');
        }
      });
    }
  };

  // ── AI 차례 ────────────────────────────────────────────────────────
  const aiTurn = (incoming: Flight) => {
    const st = s.current;
    if (st.phase !== 'outbound') return;
    const d = aiRespond(incoming, st.config.difficulty, st.rallyLen);
    if (d.miss || !d.shot || !d.quality) {
      pointTo('player', d.shot === 'smash' ? 'AI 스매시 아웃!' : 'AI가 놓쳤어요');
      return;
    }
    const posture = aiPosture(incoming, st.config.difficulty);
    st.rallyLen += 1;
    st.aiPos = HOME_ZONE; // 치고 나서 홈으로 복귀
    launch(resolveShot(d.shot, d.quality, 'ai', posture, st.rallyLen));
  };

  // ── 서브 ───────────────────────────────────────────────────────────
  const serve = useCallback((kind: 'short' | 'long', gaugePhase: number) => {
    const st = s.current;
    if (st.phase !== 'serve' || st.server !== 'player') return;
    st.rallyLen = 0;
    st.anticip = null;
    launch(resolveServe(kind, gaugePhase, 'player'));
  }, []);

  const aiServe = () => {
    const st = s.current;
    if (st.phase !== 'serve' || st.server !== 'ai') return;
    st.rallyLen = 0;
    st.anticip = null;
    const kind = Math.random() < 0.6 ? 'long' : 'short';
    const lo = st.config.difficulty === 'hard' ? 0.75 : st.config.difficulty === 'normal' ? 0.65 : 0.5;
    launch(resolveServe(kind, lo + Math.random() * (1 - lo), 'ai'));
  };

  // ── 플레이어 스윙 ──────────────────────────────────────────────────
  const swing = useCallback((gesture: SwingGesture) => {
    const st = s.current;
    if (st.phase !== 'inbound' || !st.flight || !st.windows) return;
    const delta = Date.now() - st.arrivalAt;
    const q = judgeTiming(delta, st.windows);
    if (q === 'miss') {
      pointTo('ai', delta < 0 ? '너무 빨랐어요' : '타이밍 미스');
      return;
    }
    // 제스처 → 의도한 샷, 메뉴에 없으면 수비 샷으로 강제(밀림의 대가)
    const kind = st.flight.kind;
    const intended: ShotType =
      gesture === 'smash'
        ? 'smash'
        : gesture === 'up'
          ? kind === 'high'
            ? 'clear'
            : 'lift'
          : kind === 'high'
            ? 'drop'
            : kind === 'net'
              ? 'hairpin'
              : 'block';
    const coerced = !st.menu.includes(intended);
    const shot = coerced ? st.menu[0] : intended;

    if (shot === 'smash' && q === 'bad') {
      pointTo('ai', '스매시 아웃!');
      return;
    }
    if (q === 'perfect') st.stats.perfects += 1;
    st.rallyLen += 1;
    st.lastShot = { shot, quality: q, coerced };
    st.anticip = null;
    st.playerPos = HOME_ZONE; // 치고 홈 복귀(예측 스텝으로 덮어쓸 수 있음)
    launch(resolveShot(shot, q, 'player', st.posture, st.rallyLen));
  }, []);

  // ── 예측 스텝 — 아웃바운드 동안 준비 위치를 미리 옮긴다 ─────────────
  const setAnticip = useCallback((zone: Zone | null) => {
    const st = s.current;
    if (st.phase !== 'outbound') return;
    st.anticip = zone;
    st.playerPos = zone ?? HOME_ZONE;
    pub();
  }, []);

  // ── 득점 ───────────────────────────────────────────────────────────
  const pointTo = (winner: Side, reason: string) => {
    const st = s.current;
    st.score = { ...st.score, [winner]: st.score[winner] + 1 };
    st.stats.longestRally = Math.max(st.stats.longestRally, st.rallyLen);
    st.banner = { winner, reason };
    st.phase = 'point';
    st.flight = null;
    st.deuce = isDeuce(st.score, st.config);
    st.playerPos = HOME_ZONE;
    st.aiPos = HOME_ZONE;
    const w = gameWinner(st.score, st.config);
    pub();
    after(1500, () => {
      const cur = s.current;
      if (cur.phase !== 'point') return;
      cur.banner = null;
      if (w) {
        cur.winner = w;
        cur.phase = 'over';
        pub();
        return;
      }
      cur.server = winner; // 랠리포인트 — 득점자가 서브
      cur.phase = 'serve';
      pub();
      if (winner === 'ai') after(1000, aiServe);
    });
  };

  // 첫 서브가 AI인 경우는 없음(v1은 플레이어 선서브 고정) — 단순화

  return { state: snap, start, reset, serve, swing, setAnticip };
}
