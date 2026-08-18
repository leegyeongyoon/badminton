/**
 * 콕고 랠리 v1.5 — 직접 조종 배드민턴 (뒤에서 보는 원근 코트, vs AI).
 * 왼손 조이스틱으로 캐릭터 이동, 오른쪽 스와이프로 스윙(↑클리어 ↓드롭/헤어핀
 * ↔스매시, 스와이프 좌우로 코스). 시뮬레이션은 game/rally/sim.ts,
 * 투영은 court3d.ts. 렌더 루프는 rAF에서 tick → 공유값 갱신.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import { MatchConfig, Quality, ShotType, Side, Score } from '../../game/rally/engine';
import { COURT, H_LINES, V_LINES, makeProjector, segmentStyle, Projector } from '../../game/rally/court3d';
import {
  SimState,
  SimPhase,
  SwingGesture,
  createSim,
  servePlayer,
  swingPlayer,
  tick,
} from '../../game/rally/sim';

const SERVE_PERIOD = 1100;
const servePhase = (now: number) => Math.abs(Math.sin((Math.PI * (now % SERVE_PERIOD)) / SERVE_PERIOD));

const SHOT_KO: Record<ShotType, string> = {
  clear: '클리어',
  smash: '스매시',
  drop: '드롭',
  hairpin: '헤어핀',
  lift: '리프트',
  block: '블록',
};
const Q_KO: Record<Quality, string> = { perfect: '퍼펙트!', good: '굿', bad: '뜬공…' };

function haptic(kind: 'light' | 'success' | 'error') {
  if (Platform.OS === 'web') return;
  if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

interface UiSnap {
  phase: SimPhase;
  score: Score;
  server: Side;
  deuce: boolean;
  rallyLen: number;
  banner: { winner: Side; reason: string } | null;
  winner: Side | null;
  lastShot: { shot: ShotType; quality: Quality; whiff?: boolean } | null;
  stats: { longestRally: number; perfects: number };
}

export default function RallyGameScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<'config' | 'game'>('config');
  const [cfg, setCfg] = useState<MatchConfig>({ target: 11, deuce: true, difficulty: 'normal' });
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [ui, setUi] = useState<UiSnap | null>(null);

  const simRef = useRef<SimState | null>(null);
  const joyRef = useRef({ dx: 0, dy: 0 });
  const uiKeyRef = useRef('');
  const prevAnimRef = useRef({ p: 'idle', a: 'idle' });
  const prevShuttleScreen = useRef({ x: 0, y: 0 });

  const proj: Projector | null = useMemo(
    () => (area.w > 0 ? makeProjector(area.w, area.h) : null),
    [area.w, area.h],
  );
  const projRef = useRef<Projector | null>(null);
  projRef.current = proj;
  const ppm = proj ? (proj.w * 1.38) / (COURT.HALF_LEN * -1 + 16) : 60; // near 픽셀/미터

  // ── 공유값: 엔티티 화면 좌표 ──────────────────────────────────────
  const pX = useSharedValue(0), pY = useSharedValue(0), pS = useSharedValue(1);
  const aX = useSharedValue(0), aY = useSharedValue(0), aS = useSharedValue(0.5);
  const pFace = useSharedValue(1), aFace = useSharedValue(1);
  const pLean = useSharedValue(0), aLean = useSharedValue(0);
  const pArm = useSharedValue(0), aArm = useSharedValue(0);
  const shX = useSharedValue(0), shY = useSharedValue(0), shS = useSharedValue(1);
  const shRot = useSharedValue(0), shOn = useSharedValue(0);
  const mkX = useSharedValue(0), mkY = useSharedValue(0), mkS = useSharedValue(1), mkOn = useSharedValue(0);
  const gauge = useSharedValue(0);

  // ── 게임 루프 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || !simRef.current) return;
    let raf = 0;
    let last = Date.now();
    const loop = () => {
      const p = projRef.current;
      const s = simRef.current;
      if (!p || !s) { raf = requestAnimationFrame(loop); return; }
      const now = Date.now();
      const dt = now - last;
      last = now;
      tick(s, now, dt, joyRef.current);

      // 캐릭터 투영
      pX.value = p.x(s.player.x, s.player.y);
      pY.value = p.y(s.player.y, 0);
      pS.value = p.scale(s.player.y);
      pFace.value = s.player.facing;
      pLean.value = s.player.moving ? 1 : 0;
      aX.value = p.x(s.ai.x, s.ai.y);
      aY.value = p.y(s.ai.y, 0);
      aS.value = p.scale(s.ai.y);
      aFace.value = s.ai.facing;
      aLean.value = s.ai.moving ? 1 : 0;

      // 스윙 모션 트리거
      if (s.player.anim !== prevAnimRef.current.p) {
        if (s.player.anim === 'swing' || s.player.anim === 'lunge') {
          pArm.value = -70;
          pArm.value = withSequence(withTiming(45, { duration: 130 }), withTiming(0, { duration: 220 }));
        }
        prevAnimRef.current.p = s.player.anim;
      }
      if (s.ai.anim !== prevAnimRef.current.a) {
        if (s.ai.anim === 'swing' || s.ai.anim === 'lunge') {
          aArm.value = -70;
          aArm.value = withSequence(withTiming(45, { duration: 130 }), withTiming(0, { duration: 220 }));
        }
        prevAnimRef.current.a = s.ai.anim;
      }

      // 셔틀
      const sx = p.x(s.shuttle.x, s.shuttle.y);
      const sy = p.y(s.shuttle.y, s.shuttle.z);
      shX.value = sx;
      shY.value = sy;
      shS.value = p.scale(s.shuttle.y);
      shOn.value = s.phase === 'rally' || s.phase === 'serve' ? 1 : 0;
      const dxs = sx - prevShuttleScreen.current.x;
      const dys = sy - prevShuttleScreen.current.y;
      if (Math.hypot(dxs, dys) > 1.5) shRot.value = Math.atan2(dys, dxs) + Math.PI / 2;
      prevShuttleScreen.current = { x: sx, y: sy };

      // 낙하 지점 마커 — 내게 오는 공만
      if (s.phase === 'rally' && s.traj && s.traj.by === 'ai' && s.traj.landing === 'in') {
        mkOn.value = 1;
        mkX.value = p.x(s.traj.p2.x, s.traj.p2.y);
        mkY.value = p.y(s.traj.p2.y, 0);
        mkS.value = p.scale(s.traj.p2.y);
      } else {
        mkOn.value = 0;
      }

      // 서브 게이지
      if (s.phase === 'serve' && s.server === 'player') gauge.value = servePhase(now);

      // 저빈도 React 상태 동기화
      const key = [
        s.phase, s.score.player, s.score.ai, s.server, s.deuce, s.rallyLen,
        s.banner ? s.banner.reason : '', s.winner ?? '',
        s.lastShot ? `${s.lastShot.shot}${s.lastShot.quality}${s.lastShot.whiff ? 'w' : ''}` : '',
      ].join('|');
      if (key !== uiKeyRef.current) {
        uiKeyRef.current = key;
        setUi({
          phase: s.phase, score: { ...s.score }, server: s.server, deuce: s.deuce,
          rallyLen: s.rallyLen, banner: s.banner ? { ...s.banner } : null,
          winner: s.winner, lastShot: s.lastShot ? { ...s.lastShot } : null,
          stats: { ...s.stats },
        });
        if (s.banner) haptic(s.banner.winner === 'player' ? 'success' : 'error');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // ── 조작 ──────────────────────────────────────────────────────────
  const doSwing = (g: SwingGesture, aim: -1 | 0 | 1) => {
    const s = simRef.current;
    if (!s) return;
    swingPlayer(s, g, aim, Date.now());
    haptic('light');
  };
  const doServe = (kind: 'short' | 'long') => {
    const s = simRef.current;
    if (!s) return;
    servePlayer(s, kind, servePhase(Date.now()), Date.now());
    haptic('light');
  };

  // 웹 개발용 테스트 훅 — step은 rAF가 멈춘 백그라운드 탭에서 하니스가 시뮬레이션을 전진시키는 용도
  if (Platform.OS === 'web') {
    (globalThis as unknown as Record<string, unknown>).__rally = {
      state: () => simRef.current,
      swing: doSwing,
      serve: doServe,
      setJoy: (dx: number, dy: number) => { joyRef.current = { dx, dy }; },
      step: (dt: number) => { if (simRef.current) tick(simRef.current, Date.now(), dt, joyRef.current); },
    };
  }

  // 조이스틱
  const knobX = useSharedValue(0), knobY = useSharedValue(0);
  const joyGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const r = 46;
      let dx = e.translationX, dy = e.translationY;
      const m = Math.hypot(dx, dy);
      if (m > r) { dx = (dx / m) * r; dy = (dy / m) * r; }
      knobX.value = dx;
      knobY.value = dy;
      joyRef.current = { dx: dx / r, dy: -dy / r };
    })
    .onFinalize(() => {
      knobX.value = withTiming(0, { duration: 120 });
      knobY.value = withTiming(0, { duration: 120 });
      joyRef.current = { dx: 0, dy: 0 };
    });

  // 스윙 패드 (오른쪽)
  const swingGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(8)
    .onEnd((e) => {
      const dx = e.translationX, dy = e.translationY;
      const aim: -1 | 0 | 1 = dx > 35 ? 1 : dx < -35 ? -1 : 0;
      const g: SwingGesture = Math.abs(dx) > Math.abs(dy) ? 'smash' : dy < 0 ? 'up' : 'down';
      doSwing(g, g === 'smash' ? (dx > 0 ? 1 : -1) : aim);
    });
  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => doSwing('down', 0));
  const padGesture = Gesture.Exclusive(swingGesture, tapGesture);

  // ── 애니메이티드 스타일 ───────────────────────────────────────────
  const charStyle = (x: typeof pX, y: typeof pY, sc: typeof pS, face: typeof pFace, lean: typeof pLean) =>
    useAnimatedStyle(() => ({
      transform: [
        { translateX: x.value - 30 },
        { translateY: y.value - 108 },
        { scale: sc.value },
        { scaleX: face.value },
        { rotate: `${lean.value * 4}deg` },
      ],
    }));
  const playerStyle = charStyle(pX, pY, pS, pFace, pLean);
  const aiStyle = charStyle(aX, aY, aS, aFace, aLean);
  const pArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${pArm.value}deg` }] }));
  const aArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${aArm.value}deg` }] }));
  const shuttleStyle = useAnimatedStyle(() => ({
    opacity: shOn.value,
    transform: [
      { translateX: shX.value - 9 },
      { translateY: shY.value - 12 },
      { scale: Math.max(0.45, shS.value) },
      { rotate: `${shRot.value}rad` },
    ],
  }));
  const markerStyle = useAnimatedStyle(() => ({
    opacity: mkOn.value * 0.85,
    transform: [{ translateX: mkX.value - 18 }, { translateY: mkY.value - 7 }, { scale: mkS.value }],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));
  const gaugeStyle = useAnimatedStyle(() => ({ width: `${gauge.value * 100}%` }));

  // ─────────────────────────────────────────────────────────────────
  if (screen === 'config') {
    return (
      <ConfigScreen
        cfg={cfg}
        onChange={setCfg}
        onStart={() => {
          simRef.current = createSim(cfg);
          uiKeyRef.current = '';
          setUi(null);
          setScreen('game');
        }}
      />
    );
  }

  const serving = ui?.phase === 'serve' && ui.server === 'player';

  return (
    <View style={{ flex: 1, backgroundColor: '#141A22' }}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: '#F1F5F9' }]}>콕고 랠리</Text>
        <View style={styles.scoreMid}>
          <Text style={styles.scoreText}>
            나 <Text style={styles.scoreNum}>{ui?.score.player ?? 0}</Text>
            <Text style={{ color: '#64748B' }}> : </Text>
            <Text style={styles.scoreNum}>{ui?.score.ai ?? 0}</Text> AI
          </Text>
          <View style={[styles.targetTag, ui?.deuce && { backgroundColor: '#C8443A' }]}>
            <Text style={styles.targetTagText}>{ui?.deuce ? '듀스!' : `${cfg.target}점`}</Text>
          </View>
          {(ui?.rallyLen ?? 0) > 3 && <Text style={styles.rallyText}>랠리 {ui!.rallyLen}</Text>}
        </View>
        <Pressable onPress={() => setScreen('config')} hitSlop={8}>
          <Icon name="close" size={22} color="#94A3B8" />
        </Pressable>
      </View>

      {/* 게임 영역 */}
      <View style={styles.arenaWrap}>
        <View
          style={styles.arena}
          onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {proj && <Court proj={proj} />}

          {/* 낙하 마커 */}
          <Animated.View style={[styles.marker, markerStyle]} pointerEvents="none" />

          {/* AI (원경 먼저) */}
          <Animated.View style={[styles.char, aiStyle]} pointerEvents="none">
            <Character kit="#E2695C" skin="#F0C8A0" front armStyle={aArmStyle} />
          </Animated.View>

          {/* 셔틀 */}
          <Animated.View style={[styles.shuttle, shuttleStyle]} pointerEvents="none">
            <View style={styles.shuttleSkirt} />
            <View style={styles.shuttleCork} />
          </Animated.View>

          {/* 플레이어 */}
          <Animated.View style={[styles.char, playerStyle]} pointerEvents="none">
            <Character kit="#14B8A6" skin="#F0C8A0" armStyle={pArmStyle} />
          </Animated.View>

          {/* 조작 레이어 */}
          <GestureDetector gesture={padGesture}>
            <View style={styles.swingPad} />
          </GestureDetector>
          <GestureDetector gesture={joyGesture}>
            <View style={styles.joyZone}>
              <View style={styles.joyBase}>
                <Animated.View style={[styles.joyKnob, knobStyle]} />
              </View>
            </View>
          </GestureDetector>

          {/* 득점 배너 */}
          {ui?.banner && (
            <View style={styles.bannerWrap} pointerEvents="none">
              <View style={[styles.banner, { backgroundColor: ui.banner.winner === 'player' ? '#14B8A6' : '#C8443A' }]}>
                <Text style={styles.bannerText}>
                  {ui.banner.winner === 'player' ? '+1 ' : ''}{ui.banner.reason}
                </Text>
              </View>
            </View>
          )}

          {/* 샷 피드백 */}
          {ui?.lastShot && ui.phase === 'rally' && (
            <View style={styles.shotToast} pointerEvents="none">
              <Text style={[styles.shotToastText, ui.lastShot.quality === 'perfect' && { color: '#5EEAD4' }]}>
                {ui.lastShot.whiff ? '헛스윙!' : `${SHOT_KO[ui.lastShot.shot]} · ${Q_KO[ui.lastShot.quality]}`}
              </Text>
            </View>
          )}

          {/* 서브 UI */}
          {serving && (
            <View style={styles.serveWrap}>
              <View style={styles.gaugeTrack}>
                <Animated.View style={[styles.gaugeFill, gaugeStyle]} />
                <View style={styles.gaugeTarget} />
              </View>
              <View style={styles.serveBtns}>
                <Pressable style={styles.serveBtn} onPress={() => doServe('short')}>
                  <Text style={styles.serveBtnText}>숏서브</Text>
                </Pressable>
                <Pressable style={styles.serveBtn} onPress={() => doServe('long')}>
                  <Text style={styles.serveBtnText}>롱서브</Text>
                </Pressable>
              </View>
            </View>
          )}
          {ui?.phase === 'serve' && ui.server === 'ai' && (
            <View style={styles.shotToast} pointerEvents="none">
              <Text style={styles.shotToastText}>AI 서브…</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={styles.hint}>
        왼쪽 조이스틱 이동 · 오른쪽 스와이프 스윙 (↑올리기 ↓짧게 ↔스매시, 좌우로 코스)
      </Text>

      {/* 결과 */}
      {ui?.phase === 'over' && (
        <View style={styles.overWrap}>
          <View style={[styles.overCard, { backgroundColor: colors.surface }, shadows.sm]}>
            <Icon name="trophy" size={36} color={ui.winner === 'player' ? '#14B8A6' : '#94A3B8'} />
            <Text style={[styles.overTitle, { color: colors.text }]}>
              {ui.winner === 'player' ? '승리!' : '패배…'}
            </Text>
            <Text style={[styles.overScore, { color: colors.text }]}>
              {ui.score.player} : {ui.score.ai}
            </Text>
            <Text style={[styles.overStat, { color: colors.textSecondary }]}>
              최장 랠리 {ui.stats.longestRally}구 · 퍼펙트 {ui.stats.perfects}회
            </Text>
            <Pressable
              style={[styles.againBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                simRef.current = createSim(cfg);
                uiKeyRef.current = '';
                setUi(null);
              }}
            >
              <Text style={styles.againBtnText}>한 판 더</Text>
            </Pressable>
            <Pressable onPress={() => setScreen('config')} hitSlop={8}>
              <Text style={[styles.exitText, { color: colors.textSecondary }]}>대결 설정으로</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── 코트 렌더 (정적) ───────────────────────────────────────────────
function Court({ proj }: { proj: Projector }) {
  const nearY = proj.y(-COURT.HALF_LEN, 0);
  const farY = proj.y(COURT.HALF_LEN, 0);
  const nearL = proj.x(-COURT.HALF_W, -COURT.HALF_LEN);
  const nearR = proj.x(COURT.HALF_W, -COURT.HALF_LEN);
  const farL = proj.x(-COURT.HALF_W, COURT.HALF_LEN);
  const farR = proj.x(COURT.HALF_W, COURT.HALF_LEN);
  const netTop = proj.y(0, COURT.NET_H);
  const netBottom = proj.y(0, 0);
  const netL = proj.x(-COURT.HALF_W - 0.4, 0);
  const netR = proj.x(COURT.HALF_W + 0.4, 0);

  // 그린 매트 — 원근 트라페조이드를 가로 스트립으로 근사 (코트 밖 0.55m 여유)
  const MAT_X = COURT.HALF_W + 0.55;
  const MAT_Y = COURT.HALF_LEN + 0.7;
  const STRIPS = 26;
  const strips: { left: number; top: number; width: number; height: number }[] = [];
  for (let i = 0; i < STRIPS; i++) {
    const yFar = -MAT_Y + ((2 * MAT_Y) * (i + 1)) / STRIPS;
    const yNear = -MAT_Y + ((2 * MAT_Y) * i) / STRIPS;
    const top = proj.y(yFar, 0);
    const bottom = proj.y(yNear, 0);
    const left = proj.x(-MAT_X, yNear);
    const right = proj.x(MAT_X, yNear);
    strips.push({ left, top, width: right - left, height: bottom - top + 1 });
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* 체육관 벽/바닥 */}
      <View style={[styles.wall, { height: farY - 30 }]} />
      <View style={[styles.gymFloor, { top: farY - 30 }]} />
      {/* 그린 매트 */}
      {strips.map((st, i) => (
        <View key={i} style={{ position: 'absolute', backgroundColor: '#2E8B67', ...st }} />
      ))}
      {/* 가로 라인 */}
      {H_LINES.map((l) => {
        const y = proj.y(l.y, 0);
        const x1 = proj.x(-COURT.HALF_W, l.y);
        const x2 = proj.x(COURT.HALF_W, l.y);
        return (
          <View
            key={l.label}
            style={{ position: 'absolute', left: x1, top: y - 1, width: x2 - x1, height: 2, backgroundColor: 'rgba(255,255,255,0.92)' }}
          />
        );
      })}
      {/* 세로 라인 */}
      {V_LINES.map((l) => (
        <View
          key={l.label}
          style={[
            { position: 'absolute', backgroundColor: l.label === 'center' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.92)' },
            segmentStyle(proj, l.x, -COURT.HALF_LEN, l.x, COURT.HALF_LEN, 2),
          ]}
        />
      ))}
      {/* 네트 */}
      <View style={{ position: 'absolute', left: netL, top: netTop, width: netR - netL, height: netBottom - netTop, backgroundColor: 'rgba(30,41,59,0.28)', borderTopWidth: 3, borderTopColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.4)' }} />
      <View style={{ position: 'absolute', left: netL - 2, top: netTop - 4, width: 4, height: netBottom - netTop + 4, backgroundColor: '#475569', borderRadius: 2 }} />
      <View style={{ position: 'absolute', left: netR - 2, top: netTop - 4, width: 4, height: netBottom - netTop + 4, backgroundColor: '#475569', borderRadius: 2 }} />
    </View>
  );
}

// ─── 캐릭터 ────────────────────────────────────────────────────────
function Character({ kit, skin, front, armStyle }: {
  kit: string;
  skin: string;
  front?: boolean;
  armStyle: ReturnType<typeof useAnimatedStyle>;
}) {
  return (
    <View style={styles.charBox}>
      <View style={styles.charShadow} />
      {/* 다리 */}
      <View style={[styles.leg, { left: 20 }]} />
      <View style={[styles.leg, { left: 32 }]} />
      {/* 몸통 */}
      <View style={[styles.torso, { backgroundColor: kit }]} />
      <View style={styles.shorts} />
      {/* 라켓 팔 */}
      <Animated.View style={[styles.armPivot, armStyle]}>
        <View style={[styles.arm, { backgroundColor: skin }]} />
        <View style={styles.racketShaft} />
        <View style={styles.racketHead} />
      </Animated.View>
      {/* 머리 */}
      <View style={[styles.head, { backgroundColor: skin }]} />
      <View style={[styles.hair, front ? { top: 8 } : null]} />
      {front && (
        <>
          <View style={[styles.eye, { left: 24 }]} />
          <View style={[styles.eye, { left: 32 }]} />
        </>
      )}
    </View>
  );
}

// ─── 대결 설정 ─────────────────────────────────────────────────────
function ConfigScreen({ cfg, onChange, onStart }: {
  cfg: MatchConfig;
  onChange: (c: MatchConfig) => void;
  onStart: () => void;
}) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const Seg = <T,>({ options, value, set, label }: {
    options: { v: T; label: string }[];
    value: T;
    set: (v: T) => void;
    label: string;
  }) => (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[styles.cfgLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={[styles.seg, { borderColor: colors.border }]}>
        {options.map((o) => (
          <Pressable
            key={String(o.v)}
            style={[styles.segItem, value === o.v && { backgroundColor: colors.primary }]}
            onPress={() => set(o.v)}
          >
            <Text style={[styles.segText, { color: value === o.v ? '#fff' : colors.textSecondary }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>콕고 랠리</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>v1.5</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View style={[styles.cfgCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.cfgTitle, { color: colors.text }]}>대결 설정</Text>
          <Seg
            label="몇 점 내기"
            options={[{ v: 7 as const, label: '7점' }, { v: 11 as const, label: '11점' }, { v: 21 as const, label: '21점' }]}
            value={cfg.target}
            set={(v) => onChange({ ...cfg, target: v })}
          />
          <Seg
            label="듀스"
            options={[{ v: true, label: '있음' }, { v: false, label: '없음' }]}
            value={cfg.deuce}
            set={(v) => onChange({ ...cfg, deuce: v })}
          />
          <Seg
            label="AI 난이도"
            options={[{ v: 'easy' as const, label: '쉬움' }, { v: 'normal' as const, label: '보통' }, { v: 'hard' as const, label: '어려움' }]}
            value={cfg.difficulty}
            set={(v) => onChange({ ...cfg, difficulty: v })}
          />
          <Pressable style={[styles.againBtn, { backgroundColor: colors.primary, marginTop: spacing.sm }]} onPress={onStart}>
            <Text style={styles.againBtnText}>대결 시작</Text>
          </Pressable>
        </View>
        <Text style={[styles.cfgHint, { color: colors.textLight }]}>
          왼쪽 조이스틱으로 코트를 직접 뛰고, 오른쪽 스와이프로 스윙하세요.{'\n'}
          셔틀 낙하 지점에 발이 닿아야 칠 수 있어요 — 가까울수록 퍼펙트.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  scoreMid: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  scoreText: { color: '#CBD5E1', fontSize: 13, fontWeight: '700' },
  scoreNum: { color: '#F8FAFC', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  targetTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#273449' },
  targetTagText: { fontSize: 10, fontWeight: '800', color: '#94A3B8' },
  rallyText: { fontSize: 11, fontWeight: '700', color: '#5EEAD4' },

  arenaWrap: { flex: 1, alignItems: 'center' },
  arena: { flex: 1, width: '100%', maxWidth: 480, overflow: 'hidden' },
  wall: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#1B2430' },
  gymFloor: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#6B5138' },

  marker: {
    position: 'absolute', width: 36, height: 14, borderRadius: 18,
    borderWidth: 2.5, borderColor: '#FACC15', backgroundColor: 'rgba(250,204,21,0.18)',
  },

  char: { position: 'absolute', left: 0, top: 0 },
  charBox: { width: 60, height: 112 },
  charShadow: {
    position: 'absolute', bottom: 0, left: 12, width: 36, height: 10,
    borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.3)',
  },
  leg: { position: 'absolute', bottom: 4, width: 8, height: 26, borderRadius: 4, backgroundColor: '#E8DCC8' },
  torso: { position: 'absolute', bottom: 44, left: 15, width: 30, height: 34, borderRadius: 10 },
  shorts: { position: 'absolute', bottom: 28, left: 17, width: 26, height: 18, borderRadius: 7, backgroundColor: '#1F2937' },
  armPivot: { position: 'absolute', bottom: 66, left: 40, width: 34, height: 10, transformOrigin: 'left center' } as never,
  arm: { position: 'absolute', left: 0, top: 2, width: 18, height: 7, borderRadius: 4 },
  racketShaft: { position: 'absolute', left: 16, top: 4, width: 12, height: 3, borderRadius: 2, backgroundColor: '#334155' },
  racketHead: {
    position: 'absolute', left: 25, top: -4, width: 15, height: 18, borderRadius: 9,
    borderWidth: 2.5, borderColor: '#334155', backgroundColor: 'rgba(226,232,240,0.5)',
  },
  head: { position: 'absolute', bottom: 76, left: 21, width: 18, height: 18, borderRadius: 9 },
  hair: { position: 'absolute', top: 16, left: 20, width: 20, height: 10, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: '#2B2118' },
  eye: { position: 'absolute', top: 26, width: 3, height: 3, borderRadius: 2, backgroundColor: '#1F2937' },

  shuttle: { position: 'absolute', left: 0, top: 0, alignItems: 'center', width: 18 },
  shuttleCork: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E11D48', borderWidth: 1.5, borderColor: '#FECDD3' },
  shuttleSkirt: {
    width: 0, height: 0, marginBottom: -2,
    borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 15,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#F8FAFC',
  },

  joyZone: { position: 'absolute', left: 0, bottom: 0, width: '42%', height: 190, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 22 },
  joyBase: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: 'rgba(148,163,184,0.16)',
    borderWidth: 1.5, borderColor: 'rgba(148,163,184,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  joyKnob: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(226,232,240,0.85)' },
  swingPad: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '58%' },

  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  bannerText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  shotToast: { position: 'absolute', top: 14, alignSelf: 'center' },
  shotToastText: { color: '#CBD5E1', fontSize: 13, fontWeight: '800' },

  serveWrap: { position: 'absolute', bottom: 26, alignSelf: 'center', alignItems: 'center', gap: spacing.sm, width: 240 },
  gaugeTrack: { width: '100%', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(148,163,184,0.25)' },
  gaugeFill: { height: '100%', backgroundColor: '#14B8A6', borderRadius: 6 },
  gaugeTarget: { position: 'absolute', right: '8%', top: 0, bottom: 0, width: 2, backgroundColor: '#F87171' },
  serveBtns: { flexDirection: 'row', gap: spacing.md },
  serveBtn: {
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.lg,
    backgroundColor: 'rgba(241,245,249,0.92)',
  },
  serveBtnText: { fontSize: 14, fontWeight: '800', color: '#0F172A' },

  overWrap: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  overCard: {
    width: '100%', maxWidth: 340, borderRadius: radius.card, padding: spacing.xl,
    alignItems: 'center', gap: spacing.sm,
  },
  overTitle: { ...typography.h2 },
  overScore: { fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  overStat: { ...typography.caption },
  againBtn: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.sm },
  againBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  exitText: { ...typography.caption, fontWeight: '600', marginTop: 2 },

  hint: { textAlign: 'center', fontSize: 11, color: '#64748B', paddingVertical: 8, paddingHorizontal: 16 },

  cfgCard: { borderRadius: radius.card, padding: spacing.xl },
  cfgTitle: { ...typography.h3, marginBottom: spacing.lg },
  cfgLabel: { ...typography.caption, fontWeight: '700', marginBottom: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  segText: { fontSize: 14, fontWeight: '700' },
  cfgHint: { ...typography.caption, marginTop: spacing.md, textAlign: 'center', lineHeight: 18 },
});
