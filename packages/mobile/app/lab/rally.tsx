/**
 * 콕고 랠리 v2 — 스포티(B) 아트 패스.
 * 렌더 레이어를 react-native-svg 벡터로 교체: SportyPlayer 캐릭터(포즈·사지 모션),
 * ArenaScene(클럽 나이트 코트), ShuttleFx(셔틀·트레일·히트 버스트), Jua 타이포 HUD.
 * 게임플레이는 game/rally/sim.ts 그대로 — 여기는 tick 결과를 그리기만 한다.
 */
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Jua_400Regular } from '@expo-google-fonts/jua';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import { MatchConfig, Quality, ShotType, Side, Score } from '../../game/rally/engine';
import { COURT, makeProjector, Projector } from '../../game/rally/court3d';
import {
  AimLane,
  ServeSpots,
  SimState,
  SimPhase,
  SwingIntent,
  createSim,
  servePlayer,
  serveSpots,
  swingPlayer,
  tick,
} from '../../game/rally/sim';
import { SportyPlayer } from '../../game/rally/sprites/SportyPlayer';
import { ArenaScene } from '../../game/rally/sprites/ArenaScene';
import { ShuttleSvg, HitBurstSvg } from '../../game/rally/sprites/ShuttleFx';

const SERVE_PERIOD = 1100;
const servePhase = (now: number) => Math.abs(Math.sin((Math.PI * (now % SERVE_PERIOD)) / SERVE_PERIOD));

const SHOT_KO: Record<ShotType, string> = {
  clear: '클리어',
  smash: '스매시',
  drop: '드롭',
  hairpin: '헤어핀',
  lift: '리프트',
  block: '블록',
  drive: '드라이브',
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
  lastShot: { shot: ShotType; quality: Quality; whiff?: boolean; serve?: boolean } | null;
  stats: { longestRally: number; perfects: number };
}

interface Popup {
  key: number;
  text: string;
  color: string;
  x: number;
  y: number;
  burst: boolean;
  burstColor: string;
}

export default function RallyGameScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<'config' | 'game'>('config');
  const [cfg, setCfg] = useState<MatchConfig>({ target: 11, deuce: true, difficulty: 'normal' });
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [ui, setUi] = useState<UiSnap | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [fontsLoaded] = useFonts({ Jua_400Regular });
  const jua = fontsLoaded ? 'Jua_400Regular' : undefined;

  const simRef = useRef<SimState | null>(null);
  const joyRef = useRef({ dx: 0, dy: 0 });
  const uiKeyRef = useRef('');
  const lastShotKeyRef = useRef('');
  const prevAnimRef = useRef({ p: 'idle', a: 'idle' });
  const shuttleHist = useRef<{ x: number; y: number; t: number }[]>([]);

  const proj: Projector | null = useMemo(
    () => (area.w > 0 ? makeProjector(area.w, area.h) : null),
    [area.w, area.h],
  );
  const projRef = useRef<Projector | null>(null);
  projRef.current = proj;

  // ── 공유값 ────────────────────────────────────────────────────────
  const pX = useSharedValue(0), pY = useSharedValue(0), pS = useSharedValue(1);
  const aX = useSharedValue(0), aY = useSharedValue(0), aS = useSharedValue(0.5);
  const pArm = useSharedValue(0), aArm = useSharedValue(0);
  const pLeg = useSharedValue(0), aLeg = useSharedValue(0);
  const shX = useSharedValue(0), shY = useSharedValue(0), shS = useSharedValue(1);
  const shRot = useSharedValue(0), shOn = useSharedValue(0);
  const g1X = useSharedValue(0), g1Y = useSharedValue(0), g1On = useSharedValue(0);
  const g2X = useSharedValue(0), g2Y = useSharedValue(0), g2On = useSharedValue(0);
  const shadX = useSharedValue(0), shadY = useSharedValue(0), shadO = useSharedValue(0);
  const mkX = useSharedValue(0), mkY = useSharedValue(0), mkS = useSharedValue(1), mkOn = useSharedValue(0);
  const mkPulse = useSharedValue(0);
  const laneOn = useSharedValue(0), aimLaneSV = useSharedValue(0);
  const gauge = useSharedValue(0);
  const prevShuttleScreen = useRef({ x: 0, y: 0 });

  useEffect(() => {
    mkPulse.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      // 캐릭터 위치·모션
      pX.value = p.x(s.player.x, s.player.y);
      pY.value = p.y(s.player.y, 0);
      pS.value = p.scale(s.player.y);
      aX.value = p.x(s.ai.x, s.ai.y);
      aY.value = p.y(s.ai.y, 0);
      aS.value = p.scale(s.ai.y);
      const step = Math.min(dt, 50);
      pLeg.value = s.player.moving ? (pLeg.value + step * 0.016) % (Math.PI * 2) : pLeg.value * 0.8;
      aLeg.value = s.ai.moving ? (aLeg.value + step * 0.014) % (Math.PI * 2) : aLeg.value * 0.8;
      if (s.player.anim !== prevAnimRef.current.p) {
        if (s.player.anim === 'swing' || s.player.anim === 'lunge') {
          pArm.value = -80;
          pArm.value = withSequence(withTiming(50, { duration: 120 }), withTiming(0, { duration: 240 }));
        }
        prevAnimRef.current.p = s.player.anim;
      }
      if (s.ai.anim !== prevAnimRef.current.a) {
        if (s.ai.anim === 'swing' || s.ai.anim === 'lunge') {
          aArm.value = -80;
          aArm.value = withSequence(withTiming(50, { duration: 120 }), withTiming(0, { duration: 240 }));
        }
        prevAnimRef.current.a = s.ai.anim;
      }

      // 셔틀 + 그림자 + 트레일
      const sx = p.x(s.shuttle.x, s.shuttle.y);
      const sy = p.y(s.shuttle.y, s.shuttle.z);
      shX.value = sx;
      shY.value = sy;
      shS.value = p.scale(s.shuttle.y);
      shOn.value = s.phase === 'rally' || s.phase === 'serve' ? 1 : 0;
      shadX.value = p.x(s.shuttle.x, s.shuttle.y);
      shadY.value = p.y(s.shuttle.y, 0);
      shadO.value = s.phase === 'rally' ? Math.max(0.08, 0.38 - s.shuttle.z * 0.05) : 0;
      const dxs = sx - prevShuttleScreen.current.x;
      const dys = sy - prevShuttleScreen.current.y;
      if (Math.hypot(dxs, dys) > 1.5) shRot.value = Math.atan2(dys, dxs) + Math.PI / 2;
      prevShuttleScreen.current = { x: sx, y: sy };
      const hist = shuttleHist.current;
      if (s.phase === 'rally' && s.traj) {
        hist.push({ x: sx, y: sy, t: now });
        while (hist.length > 30) hist.shift();
        const pick = (age: number) => {
          for (let i = hist.length - 1; i >= 0; i--) if (now - hist[i].t >= age) return hist[i];
          return null;
        };
        const h1 = pick(70);
        const h2 = pick(150);
        if (h1) { g1X.value = h1.x; g1Y.value = h1.y; g1On.value = 0.3; } else g1On.value = 0;
        if (h2) { g2X.value = h2.x; g2Y.value = h2.y; g2On.value = 0.14; } else g2On.value = 0;
      } else {
        hist.length = 0;
        g1On.value = 0;
        g2On.value = 0;
      }

      // 낙하 마커 (내게 오는 인)
      if (s.phase === 'rally' && s.traj && s.traj.by === 'ai' && s.traj.landing === 'in') {
        mkOn.value = 1;
        mkX.value = p.x(s.traj.p2.x, s.traj.p2.y);
        mkY.value = p.y(s.traj.p2.y, 0);
        mkS.value = p.scale(s.traj.p2.y);
      } else {
        mkOn.value = 0;
      }

      // 조준 레인
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
        const lsKey = s.lastShot ? `${s.rallyLen}|${s.lastShot.shot}|${s.lastShot.quality}|${s.lastShot.whiff ? 'w' : ''}` : '';
        if (s.lastShot && lsKey !== lastShotKeyRef.current && s.phase === 'rally') {
          lastShotKeyRef.current = lsKey;
          const q = s.lastShot.quality;
          const shotName = s.lastShot.shot === 'drop' && q === 'perfect' ? '커트' : SHOT_KO[s.lastShot.shot];
          setPopup({
            key: now,
            text: s.lastShot.whiff
              ? '헛스윙!'
              : s.lastShot.serve
                ? q === 'perfect' ? '퍼펙트 서브!' : q === 'bad' ? '흔들린 서브…' : '서브'
                : q === 'perfect' ? `${shotName}!` : q === 'good' ? shotName : '런지!',
            color: s.lastShot.whiff ? '#94A3B8' : q === 'perfect' ? '#FACC15' : q === 'good' ? '#F1F5F9' : '#FB923C',
            x: pX.value,
            y: pY.value - 130 * pS.value,
            burst: !s.lastShot.whiff,
            burstColor: q === 'perfect' ? '#FACC15' : '#E2E8F0',
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
  const playerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pX.value - 32 }, { translateY: pY.value - 122 }, { scale: pS.value }],
  }));
  const aiStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: aX.value - 32 }, { translateY: aY.value - 122 }, { scale: aS.value }],
  }));
  const pArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${pArm.value}deg` }] }));
  const aArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${aArm.value}deg` }] }));
  const pLegLStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.sin(pLeg.value) * 24}deg` }] }));
  const pLegRStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-Math.sin(pLeg.value) * 24}deg` }] }));
  const aLegLStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.sin(aLeg.value) * 24}deg` }] }));
  const aLegRStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-Math.sin(aLeg.value) * 24}deg` }] }));
  const shuttleStyle = useAnimatedStyle(() => ({
    opacity: shOn.value,
    transform: [
      { translateX: shX.value - 13 },
      { translateY: shY.value - 26 },
      { scale: Math.max(0.5, shS.value) },
      { rotate: `${shRot.value}rad` },
    ],
  }));
  const ghost1Style = useAnimatedStyle(() => ({
    opacity: g1On.value * shOn.value,
    transform: [{ translateX: g1X.value - 10 }, { translateY: g1Y.value - 20 }, { scale: 0.8 * Math.max(0.5, shS.value) }],
  }));
  const ghost2Style = useAnimatedStyle(() => ({
    opacity: g2On.value * shOn.value,
    transform: [{ translateX: g2X.value - 8 }, { translateY: g2Y.value - 17 }, { scale: 0.62 * Math.max(0.5, shS.value) }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: shadO.value,
    transform: [{ translateX: shadX.value - 10 }, { translateY: shadY.value - 4 }],
  }));
  const markerStyle = useAnimatedStyle(() => ({
    opacity: mkOn.value * 0.9,
    transform: [
      { translateX: mkX.value - 18 },
      { translateY: mkY.value - 7 },
      { scale: mkS.value * (1 + mkPulse.value * 0.18) },
    ],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));
  const gaugeStyle = useAnimatedStyle(() => ({ width: `${gauge.value * 100}%` }));
  const laneStyleFor = (lane: -1 | 0 | 1) =>
    useAnimatedStyle(() => ({
      opacity: laneOn.value === 0 ? 0 : aimLaneSV.value === lane ? 0.8 : 0.15,
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
          setGuideOpen(true);
          setScreen('game');
        }}
      />
    );
  }

  const serving = ui?.phase === 'serve' && ui.server === 'player';
  const maxScore = Math.max(ui?.score.player ?? 0, ui?.score.ai ?? 0);
  const gamePoint = !ui?.deuce && ui?.phase !== 'over' && maxScore >= cfg.target - 1 && maxScore < cfg.target;
  const spots: ServeSpots | null = ui?.phase === 'serve' && simRef.current ? serveSpots(simRef.current) : null;
  const juaStyle = jua ? { fontFamily: jua } : null;

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
          {proj && <ArenaScene proj={proj} juaFont={jua} />}

          {/* 서비스 박스 하이라이트 */}
          {proj && spots && ui && (
            <ServiceBoxHighlight proj={proj} spots={spots} server={ui.server} />
          )}

          {/* 조준 레인 */}
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

          {/* AI (원경) */}
          <Animated.View style={[styles.char, aiStyle]} pointerEvents="none">
            <SportyPlayer kit="#E2695C" variant="front" juaFont={jua} armStyle={aArmStyle} legLStyle={aLegLStyle} legRStyle={aLegRStyle} />
          </Animated.View>

          {/* 셔틀 트레일 + 본체 */}
          <Animated.View style={[styles.fx, ghost2Style]} pointerEvents="none"><ShuttleSvg size={20} /></Animated.View>
          <Animated.View style={[styles.fx, ghost1Style]} pointerEvents="none"><ShuttleSvg size={22} /></Animated.View>
          <Animated.View style={[styles.fx, shuttleStyle]} pointerEvents="none"><ShuttleSvg size={26} /></Animated.View>

          {/* 플레이어 */}
          <Animated.View style={[styles.char, playerStyle]} pointerEvents="none">
            <SportyPlayer kit="#14B8A6" variant="back" juaFont={jua} armStyle={pArmStyle} legLStyle={pLegLStyle} legRStyle={pLegRStyle} />
          </Animated.View>

          {/* 스코어보드 */}
          <View style={styles.scoreboard} pointerEvents="none">
            <View style={styles.scoreCard}>
              <View style={styles.scoreSide}>
                <View style={[styles.sideDot, { backgroundColor: '#14B8A6' }]} />
                <Text style={styles.sideName}>나</Text>
                {ui?.server === 'player' && <MaterialCommunityIcons name="badminton" size={12} color="#FACC15" />}
              </View>
              <Text style={[styles.scoreBig, juaStyle]}>{ui?.score.player ?? 0}</Text>
              <Text style={[styles.scoreColon, juaStyle]}>:</Text>
              <Text style={[styles.scoreBig, juaStyle]}>{ui?.score.ai ?? 0}</Text>
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
              {(ui?.rallyLen ?? 0) > 4 && <View style={styles.subChip}><Text style={[styles.subChipText, { color: '#5EEAD4' }]}>랠리 {ui!.rallyLen}</Text></View>}
            </View>
          </View>

          {/* 히트 버스트 + 퀄리티 팝업 */}
          {popup && popup.burst && <BurstFx key={`b${popup.key}`} popup={popup} />}
          {popup && <QualityPopup key={popup.key} popup={popup} jua={jua} />}

          {/* 득점 배너 */}
          {ui?.banner && (
            <BigBanner
              key={`${ui.score.player}-${ui.score.ai}`}
              text={ui.banner.reason}
              mine={ui.banner.winner === 'player'}
              jua={jua}
            />
          )}

          {/* 조이스틱 */}
          <GestureDetector gesture={joyGesture}>
            <View style={[styles.joyZone, ui?.phase === 'serve' && { opacity: 0.35 }]}>
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
              <ShotButton size={62} color="#E5A63C" icon="water" label="드롭" jua={jua} style={{ right: 30, bottom: 132 }} onPress={() => doSwing('drop')} />
              <ShotButton size={70} color="#1FA98C" icon="arrow-up-bold" label="클리어" jua={jua} style={{ right: 116, bottom: 48 }} onPress={() => doSwing('rally')} />
              <ShotButton size={88} color="#E2544A" icon="flash" label="스매시" jua={jua} style={{ right: 16, bottom: 30 }} onPress={() => doSwing('attack')} />
            </View>
          )}

          {/* 서브 UI */}
          {serving && (
            <View style={styles.serveWrap}>
              <Text style={styles.serveCourtText}>
                {spots?.right ? '우측' : '좌측'} 서비스 · 대각선 박스로
              </Text>
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

          {/* 첫 서브 전 조작 가이드 */}
          {guideOpen && ui?.phase === 'serve' && (
            <View style={styles.guideWrap}>
              <View style={styles.guideCard}>
                <Text style={[styles.guideTitle, juaStyle]}>조작법</Text>
                <Text style={styles.guideRow}>🕹  왼손 조이스틱 — 이동 · 기울인 채 치면 그 방향 코스</Text>
                <Text style={styles.guideRow}>⚡  스매시 — 높은 공 스매시 · 중간 높이 드라이브 · 네트 앞 킬</Text>
                <Text style={styles.guideRow}>⬆  클리어 — 높고 깊게 올려 시간 벌기</Text>
                <Text style={styles.guideRow}>💧  드롭 — 네트 앞에 톡 (퍼펙트 타이밍 = 커트)</Text>
                <Text style={styles.guideRow}>🏸  서브 — 짝수 점수 우측 · 홀수 좌측, 빛나는 대각선 박스로</Text>
                <Pressable style={styles.guideBtn} onPress={() => setGuideOpen(false)}>
                  <Text style={[styles.guideBtnText, juaStyle]}>시작하기</Text>
                </Pressable>
              </View>
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
            <Text style={[styles.overTitle, { color: colors.text }, juaStyle]}>
              {ui.winner === 'player' ? '승리!' : '패배…'}
            </Text>
            <Text style={[styles.overScore, { color: colors.text }, juaStyle]}>
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
function ShotButton({ size, color, icon, label, jua, style, onPress }: {
  size: number;
  color: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  jua?: string;
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
      <Text style={[styles.shotBtnLabel, { fontSize: size * 0.15 }, jua ? { fontFamily: jua } : null]}>{label}</Text>
    </Pressable>
  );
}

// ─── 히트 버스트 ───────────────────────────────────────────────────
function BurstFx({ popup }: { popup: Popup }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup.key]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ scale: 0.35 + t.value * 0.9 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: popup.x + 2, top: popup.y + 42, width: 60, height: 60, marginLeft: -30 }, style]}>
      <HitBurstSvg color={popup.burstColor} />
    </Animated.View>
  );
}

// ─── 퀄리티 팝업 ───────────────────────────────────────────────────
function QualityPopup({ popup, jua }: { popup: Popup; jua?: string }) {
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
      <Text style={[styles.popupText, { color: popup.color }, jua ? { fontFamily: jua, fontStyle: 'normal' } : null]}>{popup.text}</Text>
    </Animated.View>
  );
}

// ─── 득점 배너 ─────────────────────────────────────────────────────
function BigBanner({ text, mine, jua }: { text: string; mine: boolean; jua?: string }) {
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
        <Text style={[styles.bannerBig, { color: mine ? '#5EEAD4' : '#FCA5A5' }, jua ? { fontFamily: jua, fontStyle: 'normal' } : null]}>{text}</Text>
        <Text style={styles.bannerSub}>{mine ? '내 득점!' : 'AI 득점'}</Text>
      </Animated.View>
    </View>
  );
}

// ─── 서비스 박스 하이라이트 ─────────────────────────────────────────
function ServiceBoxHighlight({ proj, spots, server }: {
  proj: Projector;
  spots: ServeSpots;
  server: Side;
}) {
  const dir = server === 'player' ? 1 : -1;
  const yLo = dir === 1 ? COURT.SHORT_SERVICE : -(COURT.HALF_LEN - 0.15);
  const yHi = dir === 1 ? COURT.HALF_LEN - 0.15 : -COURT.SHORT_SERVICE;
  const xA = Math.min(spots.targetSign * 0.12, spots.targetSign * COURT.SINGLES_W);
  const xB = Math.max(spots.targetSign * 0.12, spots.targetSign * COURT.SINGLES_W);
  const N = 10;
  const strips = [];
  for (let i = 0; i < N; i++) {
    const yF = yLo + ((yHi - yLo) * (i + 1)) / N;
    const yN = yLo + ((yHi - yLo) * i) / N;
    const top = proj.y(Math.max(yF, yN), 0);
    const bottom = proj.y(Math.min(yF, yN), 0);
    const left = proj.x(xA, Math.min(yF, yN));
    const right = proj.x(xB, Math.min(yF, yN));
    strips.push({ left, top: Math.min(top, bottom), width: right - left, height: Math.abs(bottom - top) + 1 });
  }
  const cx = proj.x(spots.targetSign * 1.35, (yLo + yHi) / 2);
  const cy = proj.y((yLo + yHi) / 2, 0);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {strips.map((st, i) => (
        <View key={i} style={{ position: 'absolute', backgroundColor: 'rgba(94,234,212,0.13)', ...st }} />
      ))}
      {server === 'player' && (
        <Text style={[styles.serviceBoxLabel, { left: cx - 40, top: cy - 8 }]}>서비스 박스</Text>
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
          <Text style={[styles.betaTagText, { color: colors.primary }]}>v2</Text>
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

  scoreboard: { position: 'absolute', top: 8, alignSelf: 'center', alignItems: 'center', gap: 5 },
  scoreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(13,18,26,0.82)', paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)',
  },
  scoreSide: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sideDot: { width: 8, height: 8, borderRadius: 4 },
  sideName: { color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  scoreBig: { color: '#F8FAFC', fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 26, textAlign: 'center' },
  scoreColon: { color: '#64748B', fontSize: 20, fontWeight: '700' },
  scoreSub: { flexDirection: 'row', gap: 6 },
  subChip: { backgroundColor: 'rgba(13,18,26,0.7)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  subChipText: { fontSize: 10, fontWeight: '700', color: '#94A3B8' },

  lane: {
    position: 'absolute', width: 68, height: 60, borderRadius: 34,
    backgroundColor: 'rgba(94,234,212,0.26)', borderWidth: 2, borderColor: 'rgba(94,234,212,0.7)',
  },
  marker: {
    position: 'absolute', width: 36, height: 14, borderRadius: 18,
    borderWidth: 2.5, borderColor: '#FACC15', backgroundColor: 'rgba(250,204,21,0.2)',
  },
  shuttleShadow: {
    position: 'absolute', width: 20, height: 8, borderRadius: 10, backgroundColor: '#000',
  },

  char: { position: 'absolute', left: 0, top: 0 },
  fx: { position: 'absolute', left: 0, top: 0 },

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
  shotBtnLabel: { color: '#fff', fontWeight: '700', marginTop: 1 },

  popup: { position: 'absolute', width: 140, alignItems: 'center' },
  popupText: {
    fontSize: 19, fontWeight: '700', fontStyle: 'italic',
    textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 2 },
  },

  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bannerBig: {
    fontSize: 42, fontWeight: '700', fontStyle: 'italic', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 3 },
  },
  bannerSub: { fontSize: 14, fontWeight: '700', color: '#CBD5E1', textAlign: 'center', marginTop: 4 },

  serveWrap: { position: 'absolute', bottom: 26, alignSelf: 'center', alignItems: 'center', gap: spacing.sm, width: 260 },
  gaugeTrack: { width: '100%', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(13,18,26,0.75)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.4)' },
  gaugeFill: { height: '100%', backgroundColor: '#14B8A6' },
  gaugePerfect: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '8%', backgroundColor: 'rgba(250,204,21,0.55)' },
  gaugePerfectLabel: { position: 'absolute', right: 4, top: 1, fontSize: 8, fontWeight: '700', color: '#0F172A' },
  serveBtns: { flexDirection: 'row', gap: spacing.md },
  serveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: '#F1F5F9', borderWidth: 2, borderColor: '#CBD5E1',
  },
  serveBtnText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  aiServeToast: { position: 'absolute', bottom: 40, alignSelf: 'center' },
  aiServeText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  serveCourtText: { color: '#5EEAD4', fontSize: 12, fontWeight: '700' },
  serviceBoxLabel: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 10, fontWeight: '700', color: 'rgba(94,234,212,0.9)' },

  guideWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,14,20,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  guideCard: { width: '100%', maxWidth: 340, backgroundColor: 'rgba(17,23,32,0.97)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(94,234,212,0.35)', padding: 20, gap: 9 },
  guideTitle: { color: '#F1F5F9', fontSize: 17, fontWeight: '700', marginBottom: 2 },
  guideRow: { color: '#CBD5E1', fontSize: 12.5, lineHeight: 19, fontWeight: '600' },
  guideBtn: { marginTop: 8, backgroundColor: '#14B8A6', borderRadius: 10, alignItems: 'center', paddingVertical: 11 },
  guideBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  overWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10, 14, 20, 0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  overCard: { width: '100%', maxWidth: 340, borderRadius: radius.card, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  overTitle: { ...typography.h2 },
  overScore: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
