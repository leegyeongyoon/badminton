/**
 * 콕고 랠리 v1.6 — 게임식 UI (모바일 배드민턴 게임 문법).
 * 왼손 조이스틱 = 이동 + 코스 조준(누르는 순간의 기울기, 중립이면 오토에임).
 * 오른손 버튼 = 스매시(공격)·클리어(연결)·드롭. 상대 코트에 조준 레인 표시,
 * 셔틀 바닥 그림자·퀄리티 팝업·득점 배너로 상황이 읽히게.
 * 시뮬레이션은 game/rally/sim.ts, 투영은 court3d.ts.
 */
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import { MatchConfig, Quality, ShotType, Side, Score } from '../../game/rally/engine';
import { COURT, H_LINES, V_LINES, makeProjector, segmentStyle, Projector } from '../../game/rally/court3d';
import {
  AimLane,
  SimState,
  SimPhase,
  SwingIntent,
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

interface Popup {
  key: number;
  text: string;
  color: string;
  x: number;
  y: number;
}

export default function RallyGameScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<'config' | 'game'>('config');
  const [cfg, setCfg] = useState<MatchConfig>({ target: 11, deuce: true, difficulty: 'normal' });
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [ui, setUi] = useState<UiSnap | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);

  const simRef = useRef<SimState | null>(null);
  const joyRef = useRef({ dx: 0, dy: 0 });
  const uiKeyRef = useRef('');
  const lastShotKeyRef = useRef('');
  const prevAnimRef = useRef({ p: 'idle', a: 'idle' });

  const proj: Projector | null = useMemo(
    () => (area.w > 0 ? makeProjector(area.w, area.h) : null),
    [area.w, area.h],
  );
  const projRef = useRef<Projector | null>(null);
  projRef.current = proj;

  // ── 공유값 ────────────────────────────────────────────────────────
  const pX = useSharedValue(0), pY = useSharedValue(0), pS = useSharedValue(1);
  const aX = useSharedValue(0), aY = useSharedValue(0), aS = useSharedValue(0.5);
  const pFace = useSharedValue(1), aFace = useSharedValue(1);
  const pArm = useSharedValue(0), aArm = useSharedValue(0);
  const shX = useSharedValue(0), shY = useSharedValue(0), shS = useSharedValue(1);
  const shRot = useSharedValue(0), shOn = useSharedValue(0);
  const shadX = useSharedValue(0), shadY = useSharedValue(0), shadO = useSharedValue(0);
  const mkX = useSharedValue(0), mkY = useSharedValue(0), mkS = useSharedValue(1), mkOn = useSharedValue(0);
  const laneOn = useSharedValue(0), aimLaneSV = useSharedValue(0);
  const gauge = useSharedValue(0);
  const prevShuttleScreen = useRef({ x: 0, y: 0 });

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
      tick(s, dt, joyRef.current);

      // 캐릭터
      pX.value = p.x(s.player.x, s.player.y);
      pY.value = p.y(s.player.y, 0);
      pS.value = p.scale(s.player.y);
      pFace.value = s.player.facing;
      aX.value = p.x(s.ai.x, s.ai.y);
      aY.value = p.y(s.ai.y, 0);
      aS.value = p.scale(s.ai.y);
      aFace.value = s.ai.facing;
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

      // 셔틀 + 바닥 그림자
      const sx = p.x(s.shuttle.x, s.shuttle.y);
      const sy = p.y(s.shuttle.y, s.shuttle.z);
      shX.value = sx;
      shY.value = sy;
      shS.value = p.scale(s.shuttle.y);
      shOn.value = s.phase === 'rally' || s.phase === 'serve' ? 1 : 0;
      shadX.value = p.x(s.shuttle.x, s.shuttle.y);
      shadY.value = p.y(s.shuttle.y, 0);
      shadO.value = s.phase === 'rally' ? Math.max(0.08, 0.4 - s.shuttle.z * 0.055) : 0;
      const dxs = sx - prevShuttleScreen.current.x;
      const dys = sy - prevShuttleScreen.current.y;
      if (Math.hypot(dxs, dys) > 1.5) shRot.value = Math.atan2(dys, dxs) + Math.PI / 2;
      prevShuttleScreen.current = { x: sx, y: sy };

      // 낙하 마커 (내게 오는 인)
      if (s.phase === 'rally' && s.traj && s.traj.by === 'ai' && s.traj.landing === 'in') {
        mkOn.value = 1;
        mkX.value = p.x(s.traj.p2.x, s.traj.p2.y);
        mkY.value = p.y(s.traj.p2.y, 0);
        mkS.value = p.scale(s.traj.p2.y);
      } else {
        mkOn.value = 0;
      }

      // 조준 레인 — 랠리 중 항상, 조이스틱 기울기(중립=오토가 노리는 빈 코트)
      laneOn.value = s.phase === 'rally' ? 1 : 0;
      const jdx = joyRef.current.dx;
      aimLaneSV.value = jdx > 0.35 ? 1 : jdx < -0.35 ? -1 : s.ai.x > 0.15 ? -1 : s.ai.x < -0.15 ? 1 : 0;

      // 서브 게이지
      if (s.phase === 'serve' && s.server === 'player') gauge.value = servePhase(now);

      // 저빈도 UI 동기화
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
        // 퀄리티 팝업 — 내 스윙 위치에서 떠오른다
        const lsKey = s.lastShot ? `${s.rallyLen}|${s.lastShot.shot}|${s.lastShot.quality}|${s.lastShot.whiff ? 'w' : ''}` : '';
        if (s.lastShot && lsKey !== lastShotKeyRef.current && s.phase === 'rally') {
          lastShotKeyRef.current = lsKey;
          const q = s.lastShot.quality;
          setPopup({
            key: now,
            text: s.lastShot.whiff ? '헛스윙!' : q === 'perfect' ? `퍼펙트 ${SHOT_KO[s.lastShot.shot]}!` : q === 'good' ? SHOT_KO[s.lastShot.shot] : '런지!',
            color: s.lastShot.whiff ? '#94A3B8' : q === 'perfect' ? '#FACC15' : q === 'good' ? '#F1F5F9' : '#FB923C',
            x: pX.value,
            y: pY.value - 118 * pS.value,
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // ── 조작 ──────────────────────────────────────────────────────────
  const doSwing = (intent: SwingIntent) => {
    const s = simRef.current;
    if (!s) return;
    const jdx = joyRef.current.dx;
    const aim: AimLane = jdx > 0.35 ? 1 : jdx < -0.35 ? -1 : 'auto';
    swingPlayer(s, intent, aim);
    haptic('light');
  };
  const doServe = (kind: 'short' | 'long') => {
    const s = simRef.current;
    if (!s) return;
    servePlayer(s, kind, servePhase(Date.now()));
    haptic('light');
  };

  if (Platform.OS === 'web') {
    (globalThis as unknown as Record<string, unknown>).__rally = {
      state: () => simRef.current,
      swing: doSwing,
      serve: doServe,
      setJoy: (dx: number, dy: number) => { joyRef.current = { dx, dy }; },
      step: (dt: number) => { if (simRef.current) tick(simRef.current, dt, joyRef.current); },
    };
  }

  // 조이스틱
  const knobX = useSharedValue(0), knobY = useSharedValue(0);
  const joyGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const r = 48;
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

  // ── 애니메이티드 스타일 ───────────────────────────────────────────
  const charStyle = (x: typeof pX, y: typeof pY, sc: typeof pS, face: typeof pFace) =>
    useAnimatedStyle(() => ({
      transform: [
        { translateX: x.value - 30 },
        { translateY: y.value - 108 },
        { scale: sc.value },
        { scaleX: face.value },
      ],
    }));
  const playerStyle = charStyle(pX, pY, pS, pFace);
  const aiStyle = charStyle(aX, aY, aS, aFace);
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
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: shadO.value,
    transform: [{ translateX: shadX.value - 10 }, { translateY: shadY.value - 4 }],
  }));
  const markerStyle = useAnimatedStyle(() => ({
    opacity: mkOn.value * 0.9,
    transform: [{ translateX: mkX.value - 18 }, { translateY: mkY.value - 7 }, { scale: mkS.value }],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));
  const gaugeStyle = useAnimatedStyle(() => ({ width: `${gauge.value * 100}%` }));
  const laneStyleFor = (lane: -1 | 0 | 1) =>
    useAnimatedStyle(() => ({
      opacity: laneOn.value === 0 ? 0 : aimLaneSV.value === lane ? 0.75 : 0.14,
    }));
  const laneL = laneStyleFor(-1);
  const laneC = laneStyleFor(0);
  const laneR = laneStyleFor(1);

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
  const maxScore = Math.max(ui?.score.player ?? 0, ui?.score.ai ?? 0);
  const gamePoint = !ui?.deuce && ui?.phase !== 'over' && maxScore >= cfg.target - 1 && maxScore < cfg.target;

  return (
    <View style={{ flex: 1, backgroundColor: '#10151D' }}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <BackButton />
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setScreen('config')} hitSlop={8}>
          <Icon name="close" size={22} color="#64748B" />
        </Pressable>
      </View>

      <View style={styles.arenaWrap}>
        <View
          style={styles.arena}
          onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {proj && <Court proj={proj} />}

          {/* 조준 레인 (상대 코트) */}
          {proj && ([-1, 0, 1] as const).map((lane) => {
            const lx = proj.x(lane * 1.7, 4.4);
            const ly = proj.y(4.4, 0);
            const st = lane === -1 ? laneL : lane === 0 ? laneC : laneR;
            return (
              <Animated.View
                key={lane}
                pointerEvents="none"
                style={[styles.lane, { left: lx - 34, top: ly - 30 }, st]}
              />
            );
          })}

          {/* 낙하 마커 */}
          <Animated.View style={[styles.marker, markerStyle]} pointerEvents="none" />

          {/* 셔틀 그림자 */}
          <Animated.View style={[styles.shuttleShadow, shadowStyle]} pointerEvents="none" />

          {/* AI */}
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

          {/* 스코어보드 */}
          <View style={styles.scoreboard} pointerEvents="none">
            <View style={styles.scoreCard}>
              <View style={styles.scoreSide}>
                <View style={[styles.sideDot, { backgroundColor: '#14B8A6' }]} />
                <Text style={styles.sideName}>나</Text>
                {ui?.server === 'player' && <MaterialCommunityIcons name="badminton" size={12} color="#FACC15" />}
              </View>
              <Text style={styles.scoreBig}>{ui?.score.player ?? 0}</Text>
              <Text style={styles.scoreColon}>:</Text>
              <Text style={styles.scoreBig}>{ui?.score.ai ?? 0}</Text>
              <View style={styles.scoreSide}>
                {ui?.server === 'ai' && <MaterialCommunityIcons name="badminton" size={12} color="#FACC15" />}
                <Text style={styles.sideName}>AI</Text>
                <View style={[styles.sideDot, { backgroundColor: '#E2695C' }]} />
              </View>
            </View>
            <View style={styles.scoreSub}>
              <View style={styles.subChip}><Text style={styles.subChipText}>{cfg.target}점</Text></View>
              {ui?.deuce && <View style={[styles.subChip, { backgroundColor: '#C8443A' }]}><Text style={[styles.subChipText, { color: '#fff' }]}>듀스</Text></View>}
              {gamePoint && <View style={[styles.subChip, { backgroundColor: '#B48A2F' }]}><Text style={[styles.subChipText, { color: '#fff' }]}>게임 포인트</Text></View>}
              {(ui?.rallyLen ?? 0) > 4 && <View style={styles.subChip}><Text style={[styles.subChipText, { color: '#5EEAD4' }]}>🔥 {ui!.rallyLen}</Text></View>}
            </View>
          </View>

          {/* 퀄리티 팝업 */}
          {popup && <QualityPopup key={popup.key} popup={popup} />}

          {/* 득점 배너 */}
          {ui?.banner && (
            <BigBanner
              key={`${ui.score.player}-${ui.score.ai}`}
              text={ui.banner.reason}
              mine={ui.banner.winner === 'player'}
            />
          )}

          {/* 조이스틱 */}
          <GestureDetector gesture={joyGesture}>
            <View style={styles.joyZone}>
              <View style={styles.joyBase}>
                <View style={[styles.joyTick, { top: 6, left: 50 }]} />
                <View style={[styles.joyTick, { bottom: 6, left: 50 }]} />
                <View style={[styles.joyTick, { left: 6, top: 50 }]} />
                <View style={[styles.joyTick, { right: 6, top: 50 }]} />
                <Animated.View style={[styles.joyKnob, knobStyle]} />
              </View>
            </View>
          </GestureDetector>

          {/* 샷 버튼 */}
          {!serving && ui?.phase !== 'over' && (
            <View style={styles.btnCluster} pointerEvents="box-none">
              <ShotButton size={62} color="#E5A63C" icon="water" label="드롭" style={{ right: 30, bottom: 132 }} onPress={() => doSwing('drop')} />
              <ShotButton size={70} color="#1FA98C" icon="arrow-up-bold" label="클리어" style={{ right: 116, bottom: 48 }} onPress={() => doSwing('rally')} />
              <ShotButton size={88} color="#E2544A" icon="flash" label="스매시" style={{ right: 16, bottom: 30 }} onPress={() => doSwing('attack')} />
            </View>
          )}

          {/* 서브 UI */}
          {serving && (
            <View style={styles.serveWrap}>
              <View style={styles.gaugeTrack}>
                <View style={styles.gaugePerfect} />
                <Animated.View style={[styles.gaugeFill, gaugeStyle]} />
                <Text style={styles.gaugePerfectLabel}>PERFECT</Text>
              </View>
              <View style={styles.serveBtns}>
                <Pressable style={({ pressed }) => [styles.serveBtn, pressed && { transform: [{ scale: 0.94 }] }]} onPress={() => doServe('short')}>
                  <MaterialCommunityIcons name="arrow-collapse-down" size={18} color="#0F172A" />
                  <Text style={styles.serveBtnText}>숏서브</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.serveBtn, pressed && { transform: [{ scale: 0.94 }] }]} onPress={() => doServe('long')}>
                  <MaterialCommunityIcons name="arrow-up-bold" size={18} color="#0F172A" />
                  <Text style={styles.serveBtnText}>롱서브</Text>
                </Pressable>
              </View>
            </View>
          )}
          {ui?.phase === 'serve' && ui.server === 'ai' && (
            <View style={styles.aiServeToast} pointerEvents="none">
              <Text style={styles.aiServeText}>AI 서브…</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={styles.hint}>
        조이스틱 = 이동 + 코스 조준 (기울인 채 버튼 = 그 방향으로, 중립 = 빈 코트 자동)
      </Text>

      {/* 결과 */}
      {ui?.phase === 'over' && (
        <View style={styles.overWrap}>
          <View style={[styles.overCard, { backgroundColor: colors.surface }, shadows.sm]}>
            <MaterialCommunityIcons name="trophy" size={40} color={ui.winner === 'player' ? '#E5A63C' : '#94A3B8'} />
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

// ─── 샷 버튼 ───────────────────────────────────────────────────────
function ShotButton({ size, color, icon, label, style, onPress }: {
  size: number;
  color: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  style: { right: number; bottom: number };
  onPress: () => void;
}) {
  return (
    <Pressable
      onPressIn={onPress}
      style={({ pressed }) => [
        styles.shotBtn,
        {
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: color, right: style.right, bottom: style.bottom,
        },
        pressed && { transform: [{ scale: 0.9 }], opacity: 0.9 },
      ]}
    >
      <View style={{ position: 'absolute', top: size * 0.08, width: size * 0.52, height: size * 0.2, borderRadius: size * 0.26, backgroundColor: 'rgba(255,255,255,0.3)' }} />
      <MaterialCommunityIcons name={icon} size={size * 0.36} color="#fff" />
      <Text style={[styles.shotBtnLabel, { fontSize: size * 0.15 }]}>{label}</Text>
    </Pressable>
  );
}

// ─── 퀄리티 팝업 ───────────────────────────────────────────────────
function QualityPopup({ popup }: { popup: Popup }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup.key]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateY: -46 * t.value }, { scale: 0.8 + 0.3 * Math.min(1, t.value * 4) }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.popup, { left: popup.x - 70, top: popup.y }, style]}>
      <Text style={[styles.popupText, { color: popup.color }]}>{popup.text}</Text>
    </Animated.View>
  );
}

// ─── 득점 배너 ─────────────────────────────────────────────────────
function BigBanner({ text, mine }: { text: string; mine: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.back(1.8)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value * 2),
    transform: [{ scale: 0.5 + 0.5 * t.value }],
  }));
  return (
    <View style={styles.bannerWrap} pointerEvents="none">
      <Animated.View style={style}>
        <Text style={[styles.bannerBig, { color: mine ? '#5EEAD4' : '#FCA5A5' }]}>{text}</Text>
        <Text style={styles.bannerSub}>{mine ? '내 득점!' : 'AI 득점'}</Text>
      </Animated.View>
    </View>
  );
}

// ─── 코트 렌더 (정적) ───────────────────────────────────────────────
function Court({ proj }: { proj: Projector }) {
  const farY = proj.y(COURT.HALF_LEN, 0);
  const nearY = proj.y(-COURT.HALF_LEN, 0);

  // 매트 스트립 — 바깥(어두운 그린) 위에 코트 안(밝은 그린) 두 겹
  const buildStrips = (mx: number, my: number, n: number) => {
    const out: { left: number; top: number; width: number; height: number }[] = [];
    for (let i = 0; i < n; i++) {
      const yF = -my + ((2 * my) * (i + 1)) / n;
      const yN = -my + ((2 * my) * i) / n;
      const top = proj.y(yF, 0);
      const bottom = proj.y(yN, 0);
      const left = proj.x(-mx, yN);
      const right = proj.x(mx, yN);
      out.push({ left, top, width: right - left, height: bottom - top + 1 });
    }
    return out;
  };
  const outer = buildStrips(4.35, COURT.HALF_LEN + 1.15, 90);
  const inner = buildStrips(COURT.HALF_W, COURT.HALF_LEN, 80);

  // 백보드 광고판
  const adTop = proj.y(7.55, 1.0);
  const adBottom = proj.y(7.55, 0);
  const adL = proj.x(-4.6, 7.55);
  const adR = proj.x(4.6, 7.55);

  // 관중석 — 광고판 위 두 줄의 도트 (렌더마다 안 바뀌게 결정적 배치)
  const crowd: { left: number; top: number; c: string; s: number }[] = [];
  const crowdColors = ['#6B7A8F', '#8A6F5C', '#5C748A', '#7F6B8A', '#5F8A75', '#8A5C5C'];
  for (let i = 0; i < 46; i++) {
    const fx = ((i * 37) % 100) / 100;
    const row = i % 2;
    crowd.push({
      left: adL + (adR - adL) * fx,
      top: adTop - 14 - row * 11 - ((i * 13) % 5),
      c: crowdColors[i % crowdColors.length],
      s: 5 + ((i * 7) % 3),
    });
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.wall, { height: adTop }]} />
      <View style={[styles.gymFloor, { top: adTop }]} />
      {/* 관중석 */}
      <View style={{ position: 'absolute', left: adL - 10, top: adTop - 34, width: adR - adL + 20, height: 34, backgroundColor: '#1A222E', borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
      {crowd.map((d, i) => (
        <View key={i} style={{ position: 'absolute', left: d.left, top: d.top, width: d.s, height: d.s, borderRadius: d.s / 2, backgroundColor: d.c }} />
      ))}
      {/* 광고판 */}
      <View style={{ position: 'absolute', left: adL, top: adTop, width: adR - adL, height: adBottom - adTop, backgroundColor: '#0E7A63', borderTopWidth: 2, borderTopColor: '#134E40', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
        <Text style={styles.adText}>콕고</Text>
        <Text style={styles.adText}>KOKGO</Text>
        <Text style={styles.adText}>🏸</Text>
        <Text style={styles.adText}>콕고</Text>
      </View>
      {outer.map((st, i) => (
        <View key={`o${i}`} style={{ position: 'absolute', backgroundColor: '#1D5F47', ...st }} />
      ))}
      {inner.map((st, i) => (
        <View key={`i${i}`} style={{ position: 'absolute', backgroundColor: '#2E8B67', ...st }} />
      ))}
      {H_LINES.map((l) => {
        const y = proj.y(l.y, 0);
        const x1 = proj.x(-COURT.HALF_W, l.y);
        const x2 = proj.x(COURT.HALF_W, l.y);
        return (
          <View key={l.label} style={{ position: 'absolute', left: x1, top: y - 1, width: x2 - x1, height: 2, backgroundColor: 'rgba(255,255,255,0.92)' }} />
        );
      })}
      {V_LINES.map((l) => (
        <View
          key={l.label}
          style={[
            { position: 'absolute', backgroundColor: l.label === 'center' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.92)' },
            segmentStyle(proj, l.x, -COURT.HALF_LEN, l.x, COURT.HALF_LEN, 2),
          ]}
        />
      ))}
      {/* 네트 */}
      {(() => {
        const netTop = proj.y(0, COURT.NET_H);
        const netBottom = proj.y(0, 0);
        const netL = proj.x(-COURT.HALF_W - 0.4, 0);
        const netR = proj.x(COURT.HALF_W + 0.4, 0);
        return (
          <>
            <View style={{ position: 'absolute', left: netL, top: netTop, width: netR - netL, height: netBottom - netTop, backgroundColor: 'rgba(20,26,34,0.3)', borderTopWidth: 3, borderTopColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.35)' }} />
            <View style={{ position: 'absolute', left: netL - 2, top: netTop - 4, width: 4, height: netBottom - netTop + 4, backgroundColor: '#3D4A5C', borderRadius: 2 }} />
            <View style={{ position: 'absolute', left: netR - 2, top: netTop - 4, width: 4, height: netBottom - netTop + 4, backgroundColor: '#3D4A5C', borderRadius: 2 }} />
          </>
        );
      })()}
      {/* 근경 페이드 */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: nearY + 18, bottom: 0, backgroundColor: '#10151D' }} />
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
      {/* 신발·다리 */}
      <View style={[styles.shoe, { left: 16 }]} />
      <View style={[styles.shoe, { left: 33 }]} />
      <View style={[styles.leg, { left: 20, backgroundColor: skin }]} />
      <View style={[styles.leg, { left: 33, backgroundColor: skin }]} />
      {/* 하의·유니폼 */}
      <View style={styles.shorts} />
      <View style={[styles.jersey, { backgroundColor: kit }]} />
      <View style={styles.jerseyStripe} />
      {/* 왼팔 */}
      <View style={[styles.armLeft, { backgroundColor: skin }]} />
      {/* 라켓 팔 */}
      <Animated.View style={[styles.armPivot, armStyle]}>
        <View style={[styles.arm, { backgroundColor: skin }]} />
        <View style={styles.racketShaft} />
        <View style={styles.racketHead} />
        <View style={styles.racketString} />
      </Animated.View>
      {/* 머리 */}
      <View style={[styles.head, { backgroundColor: skin }]} />
      <View style={styles.hair} />
      <View style={styles.headband} />
      {front && (
        <>
          <View style={[styles.eye, { left: 25 }]} />
          <View style={[styles.eye, { left: 33 }]} />
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
        <Text style={[styles.cfgScreenTitle, { color: colors.text }]}>콕고 랠리</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>v1.6</Text>
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
          왼손 조이스틱으로 뛰고, 오른손 버튼으로 스매시·클리어·드롭.{'\n'}
          조이스틱을 기울인 채 치면 그 방향 코스, 중립이면 빈 코트를 자동으로 노려요.
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
    paddingHorizontal: spacing.md,
    paddingBottom: 6,
  },
  cfgScreenTitle: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  arenaWrap: { flex: 1, alignItems: 'center' },
  arena: { flex: 1, width: '100%', maxWidth: 480, overflow: 'hidden' },
  wall: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#151C26' },
  gymFloor: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#243043' },
  adText: { color: 'rgba(255,255,255,0.85)', fontWeight: '900', fontSize: 11, letterSpacing: 1 },

  scoreboard: { position: 'absolute', top: 8, alignSelf: 'center', alignItems: 'center', gap: 5 },
  scoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(13,18,26,0.82)', paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)',
  },
  scoreSide: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sideDot: { width: 8, height: 8, borderRadius: 4 },
  sideName: { color: '#CBD5E1', fontSize: 12, fontWeight: '800' },
  scoreBig: { color: '#F8FAFC', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 26, textAlign: 'center' },
  scoreColon: { color: '#64748B', fontSize: 20, fontWeight: '900' },
  scoreSub: { flexDirection: 'row', gap: 6 },
  subChip: { backgroundColor: 'rgba(13,18,26,0.7)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  subChipText: { fontSize: 10, fontWeight: '800', color: '#94A3B8' },

  lane: {
    position: 'absolute', width: 68, height: 60, borderRadius: 34,
    backgroundColor: 'rgba(94,234,212,0.28)', borderWidth: 2, borderColor: 'rgba(94,234,212,0.7)',
  },
  marker: {
    position: 'absolute', width: 36, height: 14, borderRadius: 18,
    borderWidth: 2.5, borderColor: '#FACC15', backgroundColor: 'rgba(250,204,21,0.2)',
  },
  shuttleShadow: {
    position: 'absolute', width: 20, height: 8, borderRadius: 10, backgroundColor: '#000',
  },

  char: { position: 'absolute', left: 0, top: 0 },
  charBox: { width: 60, height: 112 },
  charShadow: { position: 'absolute', bottom: 0, left: 10, width: 40, height: 10, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.32)' },
  shoe: { position: 'absolute', bottom: 2, width: 12, height: 6, borderRadius: 3, backgroundColor: '#F8FAFC' },
  leg: { position: 'absolute', bottom: 7, width: 7, height: 24, borderRadius: 4 },
  shorts: { position: 'absolute', bottom: 28, left: 16, width: 28, height: 17, borderRadius: 6, backgroundColor: '#1E293B' },
  jersey: { position: 'absolute', bottom: 42, left: 14, width: 32, height: 33, borderRadius: 9 },
  jerseyStripe: { position: 'absolute', bottom: 43, left: 17, width: 4, height: 29, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.65)' },
  armLeft: { position: 'absolute', bottom: 50, left: 7, width: 8, height: 22, borderRadius: 4, transform: [{ rotate: '14deg' }] },
  armPivot: { position: 'absolute', bottom: 64, left: 41, width: 36, height: 10, transformOrigin: 'left center' } as never,
  arm: { position: 'absolute', left: 0, top: 2, width: 18, height: 7, borderRadius: 4 },
  racketShaft: { position: 'absolute', left: 16, top: 4, width: 12, height: 3, borderRadius: 2, backgroundColor: '#475569' },
  racketHead: { position: 'absolute', left: 26, top: -6, width: 16, height: 20, borderRadius: 10, borderWidth: 2.5, borderColor: '#475569', backgroundColor: 'rgba(241,245,249,0.55)' },
  racketString: { position: 'absolute', left: 33, top: -3, width: 1.5, height: 14, backgroundColor: 'rgba(71,85,105,0.5)' },
  head: { position: 'absolute', bottom: 76, left: 19, width: 22, height: 22, borderRadius: 11 },
  hair: { position: 'absolute', top: 11, left: 18, width: 24, height: 11, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: '#2B2118' },
  headband: { position: 'absolute', top: 21, left: 18, width: 24, height: 4, borderRadius: 2, backgroundColor: '#F8FAFC' },
  eye: { position: 'absolute', top: 28, width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: '#1F2937' },

  shuttle: { position: 'absolute', left: 0, top: 0, alignItems: 'center', width: 18 },
  shuttleCork: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E11D48', borderWidth: 1.5, borderColor: '#FECDD3' },
  shuttleSkirt: {
    width: 0, height: 0, marginBottom: -2,
    borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 15,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#F8FAFC',
  },

  joyZone: { position: 'absolute', left: 0, bottom: 0, width: '44%', height: 210, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 26 },
  joyBase: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(148,163,184,0.14)',
    borderWidth: 1.5, borderColor: 'rgba(148,163,184,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  joyTick: { position: 'absolute', width: 8, height: 3, borderRadius: 2, backgroundColor: 'rgba(148,163,184,0.5)', marginLeft: -4 },
  joyKnob: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(241,245,249,0.9)',
    borderWidth: 2, borderColor: 'rgba(148,163,184,0.6)',
  },

  btnCluster: { ...StyleSheet.absoluteFillObject },
  shotBtn: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  shotBtnLabel: { color: '#fff', fontWeight: '900', marginTop: 1 },

  popup: { position: 'absolute', width: 140, alignItems: 'center' },
  popupText: {
    fontSize: 19, fontWeight: '900', fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 2 },
  },

  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bannerBig: {
    fontSize: 40, fontWeight: '900', fontStyle: 'italic', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 3 },
  },
  bannerSub: { fontSize: 14, fontWeight: '800', color: '#CBD5E1', textAlign: 'center', marginTop: 4 },

  serveWrap: { position: 'absolute', bottom: 30, alignSelf: 'center', alignItems: 'center', gap: spacing.md, width: 260 },
  gaugeTrack: { width: '100%', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(13,18,26,0.75)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.4)' },
  gaugeFill: { height: '100%', backgroundColor: '#14B8A6' },
  gaugePerfect: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '8%', backgroundColor: 'rgba(250,204,21,0.55)' },
  gaugePerfectLabel: { position: 'absolute', right: 4, top: 1, fontSize: 8, fontWeight: '900', color: '#0F172A' },
  serveBtns: { flexDirection: 'row', gap: spacing.md },
  serveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: '#F1F5F9', borderWidth: 2, borderColor: '#CBD5E1',
  },
  serveBtnText: { fontSize: 14, fontWeight: '900', color: '#0F172A' },
  aiServeToast: { position: 'absolute', bottom: 40, alignSelf: 'center' },
  aiServeText: { color: '#94A3B8', fontSize: 13, fontWeight: '800' },

  overWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10, 14, 20, 0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  overCard: { width: '100%', maxWidth: 340, borderRadius: radius.card, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  overTitle: { ...typography.h2 },
  overScore: { fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  overStat: { ...typography.caption },
  againBtn: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.sm },
  againBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  exitText: { ...typography.caption, fontWeight: '600', marginTop: 2 },

  hint: { textAlign: 'center', fontSize: 11, color: '#5B6675', paddingVertical: 8, paddingHorizontal: 16 },

  cfgCard: { borderRadius: radius.card, padding: spacing.xl },
  cfgTitle: { ...typography.h3, marginBottom: spacing.lg },
  cfgLabel: { ...typography.caption, fontWeight: '700', marginBottom: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  segText: { fontSize: 14, fontWeight: '700' },
  cfgHint: { ...typography.caption, marginTop: spacing.md, textAlign: 'center', lineHeight: 18 },
});
