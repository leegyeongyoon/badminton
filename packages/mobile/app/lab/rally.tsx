/**
 * 콕고 랠리 v1 — 1:1 배드민턴 대결 미니게임 (vs AI 프로토타입).
 * 사이드뷰 타이밍 랠리: 셔틀 도착 타이밍에 스와이프(↑클리어/리프트,
 * ↓드롭/헤어핀/블록, →스매시)로 스윙. 아웃바운드 동안 코트 드래그로
 * 예측 스텝(앞/중/뒤). 규칙·판정은 game/rally/engine.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import { MatchConfig, ShotType, Zone } from '../../game/rally/engine';
import { useRallyGame, SwingGesture } from '../../game/rally/useRallyGame';

// ─── 코트 지오메트리 ───────────────────────────────────────────────
const COURT_H = 300;
const FLOOR_Y = COURT_H - 28;
const SERVE_PERIOD = 1100; // 서브 게이지 주기(ms)

// 존(깊이) → 화면 x 비율. 0=네트 앞, 2=백코트.
function zoneRatio(side: 'player' | 'ai', zone: Zone): number {
  return side === 'player' ? 0.4 - 0.15 * zone : 0.6 + 0.15 * zone;
}

const SHOT_LABEL: Record<ShotType, string> = {
  clear: '클리어 ↑',
  smash: '스매시 →',
  drop: '드롭 ↓',
  hairpin: '헤어핀 ↓',
  lift: '리프트 ↑',
  block: '블록 ↓',
};
const QUALITY_LABEL = { perfect: '퍼펙트!', good: '굿', bad: '뜬공…' } as const;
const ZONE_LABEL = ['네트 앞', '중앙', '뒤'] as const;

function haptic(kind: 'light' | 'success' | 'error') {
  if (Platform.OS === 'web') return;
  if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

function servePhase(now: number): number {
  return Math.abs(Math.sin((Math.PI * (now % SERVE_PERIOD)) / SERVE_PERIOD));
}

export default function RallyGameScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, start, reset, serve, swing, setAnticip } = useRallyGame();

  const [courtW, setCourtW] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 각 사이드가 마지막으로 친/받은 존 — 셔틀 시작 좌표용
  const lastZone = useRef<{ player: Zone; ai: Zone }>({ player: 1, ai: 1 });
  const anticipZoneRef = useRef<Zone | null>(null);

  // ── 셔틀 비행 애니메이션 ──────────────────────────────────────────
  const prog = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const ex = useSharedValue(0);
  const ey = useSharedValue(0);
  const apexPix = useSharedValue(0);
  const shuttleOn = useSharedValue(0);
  const ringP = useSharedValue(0);
  const ringX = useSharedValue(0);

  useEffect(() => {
    const f = state.flight;
    if (!f || courtW === 0) {
      shuttleOn.value = 0;
      ringP.value = 0;
      return;
    }
    const receiver = f.by === 'player' ? 'ai' : 'player';
    const startZone = lastZone.current[f.by];
    sx.value = zoneRatio(f.by, startZone) * courtW;
    ex.value = zoneRatio(receiver, f.toZone) * courtW;
    sy.value = FLOOR_Y - (f.shot === 'smash' ? 105 : 58);
    ey.value = FLOOR_Y - 36;
    apexPix.value = f.apex * 155;
    lastZone.current[receiver] = f.toZone;

    shuttleOn.value = 1;
    prog.value = 0;
    prog.value = withTiming(1, { duration: f.ms, easing: Easing.linear });

    // 타이밍 링 — 내게 날아올 때만
    if (f.by === 'ai') {
      ringX.value = ex.value;
      ringP.value = 0;
      ringP.value = withTiming(1, { duration: f.ms, easing: Easing.linear });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flightKey, state.flight === null, courtW]);

  const shuttleStyle = useAnimatedStyle(() => {
    const t = prog.value;
    const x = sx.value + (ex.value - sx.value) * t;
    const y = sy.value + (ey.value - sy.value) * t - apexPix.value * 4 * t * (1 - t);
    return { opacity: shuttleOn.value, transform: [{ translateX: x - 7 }, { translateY: y - 9 }] };
  });

  const ringStyle = useAnimatedStyle(() => {
    const scale = 2.4 - 1.4 * Math.min(ringP.value, 1);
    return {
      opacity: ringP.value > 0 && ringP.value < 1.001 ? 0.9 : 0,
      transform: [{ translateX: ringX.value - 26 }, { translateY: FLOOR_Y - 72 }, { scale }],
    };
  });

  // ── 캐릭터 위치 ───────────────────────────────────────────────────
  const playerX = useSharedValue(0);
  const aiX = useSharedValue(0);
  useEffect(() => {
    if (courtW === 0) return;
    playerX.value = withTiming(zoneRatio('player', state.playerPos) * courtW - 14, { duration: 320 });
    aiX.value = withTiming(zoneRatio('ai', state.aiPos) * courtW - 14, { duration: 320 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playerPos, state.aiPos, courtW]);
  const playerXStyle = useAnimatedStyle(() => ({ transform: [{ translateX: playerX.value }] }));
  const aiXStyle = useAnimatedStyle(() => ({ transform: [{ translateX: aiX.value }] }));

  // ── 서브 게이지 — 타임스탬프 기반이라 표시와 판정이 항상 일치 ───────
  const gauge = useSharedValue(0);
  const serving = state.phase === 'serve' && state.server === 'player';
  const frame = useFrameCallback(() => {
    gauge.value = servePhase(Date.now());
  }, false);
  useEffect(() => {
    frame.setActive(serving);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serving]);
  const gaugeStyle = useAnimatedStyle(() => ({ width: `${gauge.value * 100}%` }));

  // ── 제스처: 인바운드 스윙 + 아웃바운드 예측 스텝 ───────────────────
  const doSwing = (g: SwingGesture) => {
    swing(g);
    haptic('light');
  };
  // 웹 개발용 테스트 훅 — 자동 플레이 하니스가 실제 상태 기준으로 조작할 수 있게
  if (Platform.OS === 'web') {
    (globalThis as unknown as Record<string, unknown>).__rally = { swing: doSwing, serve, state: () => stateRef.current };
  }
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onUpdate((e) => {
      if (stateRef.current.phase !== 'outbound' || courtW === 0) return;
      const r = e.x / courtW;
      const zone: Zone = r < 0.17 ? 2 : r < 0.32 ? 1 : 0; // 내 코트 절반 기준
      if (anticipZoneRef.current !== zone) {
        anticipZoneRef.current = zone;
        setAnticip(zone);
      }
    })
    .onEnd((e) => {
      anticipZoneRef.current = null;
      if (stateRef.current.phase !== 'inbound') return;
      const g: SwingGesture =
        Math.abs(e.translationX) > Math.abs(e.translationY) && e.translationX > 24
          ? 'smash'
          : e.translationY < 0
            ? 'up'
            : 'down';
      doSwing(g);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => {
      if (stateRef.current.phase === 'inbound') doSwing('down'); // 살짝 탭 = 네트 샷
    });
  const gesture = Gesture.Exclusive(pan, tap);

  // 득점/게임 종료 햅틱
  useEffect(() => {
    if (state.banner) haptic(state.banner.winner === 'player' ? 'success' : 'error');
  }, [state.banner]);

  // ─────────────────────────────────────────────────────────────────
  if (state.phase === 'config') {
    return <ConfigScreen onStart={start} />;
  }

  const f = state.flight;
  const inbound = state.phase === 'inbound';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>콕고 랠리</Text>
        <Pressable onPress={reset} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <Icon name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* 스코어보드 */}
      <View style={[styles.scoreRow, { backgroundColor: colors.surface }]}>
        <Text style={[styles.scoreName, { color: colors.text }]}>나</Text>
        <Text style={[styles.scoreNum, { color: colors.text }]}>
          {state.score.player} <Text style={{ color: colors.textLight }}>:</Text> {state.score.ai}
        </Text>
        <Text style={[styles.scoreName, { color: colors.text }]}>AI</Text>
        <View style={[styles.targetTag, { backgroundColor: state.deuce ? '#C8443A' : colors.surfaceSecondary }]}>
          <Text style={[styles.targetTagText, { color: state.deuce ? '#fff' : colors.textSecondary }]}>
            {state.deuce ? '듀스!' : `${state.config.target}점`}
          </Text>
        </View>
        {state.rallyLen > 3 && (
          <Text style={[styles.rallyText, { color: colors.textSecondary }]}>랠리 {state.rallyLen}</Text>
        )}
        {state.server === 'player' && state.phase === 'serve' && (
          <Text style={[styles.rallyText, { color: colors.primary }]}>내 서브</Text>
        )}
      </View>

      {/* 코트 */}
      <GestureDetector gesture={gesture}>
        <View
          style={styles.court}
          onLayout={(e) => setCourtW(e.nativeEvent.layout.width)}
        >
          {/* 바닥·네트 */}
          <View style={styles.floor} />
          <View style={styles.net} />
          <View style={styles.netTape} />

          {/* 예측 스텝 마커 */}
          {state.anticip !== null && courtW > 0 && (
            <View
              style={[
                styles.anticipMark,
                { left: zoneRatio('player', state.anticip) * courtW - 18 },
              ]}
            >
              <Text style={styles.anticipText}>{ZONE_LABEL[state.anticip]}</Text>
            </View>
          )}

          {/* 타이밍 링 */}
          <Animated.View style={[styles.ring, ringStyle]} pointerEvents="none" />

          {/* 캐릭터 */}
          {courtW > 0 && (
            <>
              <Animated.View style={[styles.char, playerXStyle]}>
                <View style={[styles.charHead, { backgroundColor: '#14B8A6' }]} />
                <View
                  style={[
                    styles.charBody,
                    { backgroundColor: '#14B8A6' },
                    inbound && state.posture === 'pushed' && { transform: [{ rotate: '-18deg' }] },
                  ]}
                />
              </Animated.View>
              <Animated.View style={[styles.char, aiXStyle]}>
                <View style={[styles.charHead, { backgroundColor: '#94A3B8' }]} />
                <View style={[styles.charBody, { backgroundColor: '#94A3B8' }]} />
              </Animated.View>
            </>
          )}

          {/* 셔틀콕 */}
          <Animated.View style={[styles.shuttle, shuttleStyle]} pointerEvents="none">
            <View style={styles.shuttleSkirt} />
            <View style={styles.shuttleCork} />
          </Animated.View>

          {/* 득점 배너 */}
          {state.banner && (
            <View style={styles.bannerWrap} pointerEvents="none">
              <View style={[styles.banner, { backgroundColor: state.banner.winner === 'player' ? '#14B8A6' : '#C8443A' }]}>
                <Text style={styles.bannerText}>
                  {state.banner.winner === 'player' ? '+1 득점!' : '실점'} · {state.banner.reason}
                </Text>
              </View>
            </View>
          )}
        </View>
      </GestureDetector>

      {/* HUD */}
      <View style={styles.hud}>
        {inbound && (
          <View style={styles.menuRow}>
            {state.posture === 'pushed' && (
              <View style={[styles.chip, { backgroundColor: '#C8443A' }]}>
                <Text style={styles.chipTextOn}>밀림!</Text>
              </View>
            )}
            {state.menu.map((s) => (
              <View key={s} style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.chipText, { color: colors.text }]}>{SHOT_LABEL[s]}</Text>
              </View>
            ))}
          </View>
        )}
        {state.phase === 'outbound' && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            코트를 드래그해 예측 스텝 — 앞으로 붙거나 뒤로 빠지세요
          </Text>
        )}
        {state.lastShot && state.phase !== 'serve' && (
          <Text style={[styles.lastShot, { color: state.lastShot.quality === 'perfect' ? '#14B8A6' : colors.textSecondary }]}>
            {state.lastShot.coerced ? '밀려서 ' : ''}
            {SHOT_LABEL[state.lastShot.shot].split(' ')[0]} · {QUALITY_LABEL[state.lastShot.quality]}
          </Text>
        )}

        {/* 서브 */}
        {serving && (
          <View style={styles.serveWrap}>
            <View style={[styles.gaugeTrack, { backgroundColor: colors.surfaceSecondary }]}>
              <Animated.View style={[styles.gaugeFill, gaugeStyle]} />
              <View style={styles.gaugeTarget} />
            </View>
            <View style={styles.serveBtns}>
              <Pressable
                style={[styles.serveBtn, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}
                onPress={() => serve('short', servePhase(Date.now()))}
              >
                <Text style={[styles.serveBtnText, { color: colors.text }]}>숏서브</Text>
              </Pressable>
              <Pressable
                style={[styles.serveBtn, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}
                onPress={() => serve('long', servePhase(Date.now()))}
              >
                <Text style={[styles.serveBtnText, { color: colors.text }]}>롱서브</Text>
              </Pressable>
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              게이지가 꽉 찼을 때 서브하면 퍼펙트
            </Text>
          </View>
        )}
        {state.phase === 'serve' && state.server === 'ai' && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>AI 서브를 기다리는 중…</Text>
        )}
        {inbound && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            셔틀 도착에 맞춰 스와이프 — ↑ 올리기 · ↓ 짧게 · → 스매시
          </Text>
        )}
      </View>

      {/* 결과 */}
      {state.phase === 'over' && (
        <View style={styles.overWrap}>
          <View style={[styles.overCard, { backgroundColor: colors.surface }, shadows.sm]}>
            <Icon name="trophy" size={36} color={state.winner === 'player' ? '#14B8A6' : '#94A3B8'} />
            <Text style={[styles.overTitle, { color: colors.text }]}>
              {state.winner === 'player' ? '승리!' : '패배…'}
            </Text>
            <Text style={[styles.overScore, { color: colors.text }]}>
              {state.score.player} : {state.score.ai}
            </Text>
            <Text style={[styles.overStat, { color: colors.textSecondary }]}>
              최장 랠리 {state.stats.longestRally}구 · 퍼펙트 {state.stats.perfects}회
            </Text>
            <Pressable
              style={[styles.againBtn, { backgroundColor: colors.primary }]}
              onPress={() => start(state.config)}
            >
              <Text style={styles.againBtnText}>한 판 더</Text>
            </Pressable>
            <Pressable onPress={reset} hitSlop={8}>
              <Text style={[styles.exitText, { color: colors.textSecondary }]}>대결 설정으로</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── 대결 설정 ─────────────────────────────────────────────────────
function ConfigScreen({ onStart }: { onStart: (c: MatchConfig) => void }) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [target, setTarget] = useState<7 | 11 | 21>(11);
  const [deuce, setDeuce] = useState(true);
  const [difficulty, setDifficulty] = useState<MatchConfig['difficulty']>('normal');

  const Seg = <T extends string | number>({ options, value, onChange, label }: {
    options: { v: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    label: string;
  }) => (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[styles.cfgLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={[styles.seg, { borderColor: colors.border }]}>
        {options.map((o) => (
          <Pressable
            key={String(o.v)}
            style={[styles.segItem, value === o.v && { backgroundColor: colors.primary }]}
            onPress={() => onChange(o.v)}
          >
            <Text style={[styles.segText, { color: value === o.v ? '#fff' : colors.textSecondary }]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>콕고 랠리</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.betaTagText, { color: colors.primary }]}>v1</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View style={[styles.cfgCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.cfgTitle, { color: colors.text }]}>대결 설정</Text>
          <Seg
            label="몇 점 내기"
            options={[{ v: 7 as const, label: '7점' }, { v: 11 as const, label: '11점' }, { v: 21 as const, label: '21점' }]}
            value={target}
            onChange={setTarget}
          />
          <Seg
            label="듀스"
            options={[{ v: 'on', label: '있음' }, { v: 'off', label: '없음' }]}
            value={deuce ? 'on' : 'off'}
            onChange={(v) => setDeuce(v === 'on')}
          />
          <Seg
            label="AI 난이도"
            options={[{ v: 'easy' as const, label: '쉬움' }, { v: 'normal' as const, label: '보통' }, { v: 'hard' as const, label: '어려움' }]}
            value={difficulty}
            onChange={setDifficulty}
          />
          <Pressable
            style={[styles.againBtn, { backgroundColor: colors.primary, marginTop: spacing.sm }]}
            onPress={() => onStart({ target, deuce, difficulty })}
          >
            <Text style={styles.againBtnText}>대결 시작</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: colors.textLight, marginTop: spacing.md, textAlign: 'center' }]}>
          ↑ 클리어/리프트 · ↓ 드롭/헤어핀 · → 스매시{'\n'}상대에게 날아가는 동안 코트 드래그 = 예측 스텝
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { ...typography.h3 },
  betaTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  betaTagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  scoreName: { ...typography.caption, fontWeight: '700' },
  scoreNum: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  targetTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  targetTagText: { fontSize: 11, fontWeight: '800' },
  rallyText: { ...typography.caption, fontWeight: '700', marginLeft: 'auto' },

  court: {
    height: COURT_H,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: '#0E4732',
    overflow: 'hidden',
  },
  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: FLOOR_Y,
    height: COURT_H - FLOOR_Y,
    backgroundColor: '#0A3826',
  },
  net: {
    position: 'absolute',
    left: '50%',
    top: FLOOR_Y - 64,
    width: 2,
    height: 64,
    backgroundColor: '#E2E8F0',
    opacity: 0.85,
  },
  netTape: {
    position: 'absolute',
    left: '50%',
    marginLeft: -5,
    top: FLOOR_Y - 68,
    width: 12,
    height: 5,
    backgroundColor: '#F8FAFC',
    borderRadius: 2,
  },
  char: { position: 'absolute', top: FLOOR_Y - 52, alignItems: 'center', width: 28 },
  charHead: { width: 14, height: 14, borderRadius: 7 },
  charBody: { width: 10, height: 34, borderRadius: 5, marginTop: 2 },
  shuttle: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
  shuttleCork: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E11D48' },
  shuttleSkirt: {
    width: 14,
    height: 12,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: '#F8FAFC',
    marginBottom: -3,
  },
  ring: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: '#FACC15',
  },
  anticipMark: {
    position: 'absolute',
    top: FLOOR_Y + 4,
    width: 36,
    alignItems: 'center',
  },
  anticipText: { fontSize: 9, fontWeight: '800', color: '#FACC15' },
  bannerWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  bannerText: { color: '#fff', fontWeight: '900', fontSize: 15 },

  hud: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, alignItems: 'center', gap: spacing.sm },
  menuRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  chipText: { fontSize: 12, fontWeight: '700' },
  chipTextOn: { fontSize: 12, fontWeight: '900', color: '#fff' },
  hint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  lastShot: { fontSize: 13, fontWeight: '800' },

  serveWrap: { width: '100%', maxWidth: 420, alignItems: 'center', gap: spacing.md },
  gaugeTrack: { width: '100%', height: 14, borderRadius: 7, overflow: 'hidden' },
  gaugeFill: { height: '100%', backgroundColor: '#14B8A6', borderRadius: 7 },
  gaugeTarget: { position: 'absolute', right: '8%', top: 0, bottom: 0, width: 2, backgroundColor: '#C8443A' },
  serveBtns: { flexDirection: 'row', gap: spacing.md },
  serveBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  serveBtnText: { fontSize: 15, fontWeight: '800' },

  overWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  overCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  overTitle: { ...typography.h2 },
  overScore: { fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  overStat: { ...typography.caption },
  againBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  againBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  exitText: { ...typography.caption, fontWeight: '600', marginTop: 2 },

  cfgCard: { borderRadius: radius.card, padding: spacing.xl },
  cfgTitle: { ...typography.h3, marginBottom: spacing.lg },
  cfgLabel: { ...typography.caption, fontWeight: '700', marginBottom: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  segText: { fontSize: 14, fontWeight: '700' },
});
