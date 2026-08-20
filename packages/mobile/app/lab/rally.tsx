/**
 * 콕고 랠리 v2 — 스포티(B) 아트 패스.
 * 렌더 레이어를 react-native-svg 벡터로 교체: SportyPlayer 캐릭터(포즈·사지 모션),
 * ArenaScene(클럽 나이트 코트), ShuttleFx(셔틀·트레일·히트 버스트), Jua 타이포 HUD.
 * 게임플레이는 game/rally/sim.ts 그대로 — 여기는 tick 결과를 그리기만 한다.
 */
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
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
  AimDepth,
  AimLane,
  MotionKey,
  ServeSpots,
  SimState,
  SimPhase,
  SwingIntent,
  applySnapshot,
  createSim,
  guestTick,
  makeSnapshot,
  servePlayer,
  serveRemote,
  serveSpots,
  swingPlayer,
  swingRemote,
  tick,
} from '../../game/rally/sim';
import { connectRally, RallyNet } from '../../game/rally/net';
import { rallyApi } from '../../services/rally';
import { clubSessionApi } from '../../services/clubSession';
import { profileApi } from '../../services/profile';
import { useAuthStore } from '../../store/authStore';
import { useSocketEvent } from '../../hooks/useSocket';
import { showError, showInfo } from '../../utils/feedback';
import { PlayerCard, PlayerCardData } from '../../components/game-board/PlayerCard';
import { RigCharacter, RigClip, RigHandle } from '../../game/rally/sprites/RigCharacter';
import { ArenaScene, CourtNet } from '../../game/rally/sprites/ArenaScene';
import { ShuttleSvg, HitBurstSvg } from '../../game/rally/sprites/ShuttleFx';

// Kenney UI Pack (CC0) — 게임식 버튼·조이스틱
const UI_IMG = {
  red: require('../../assets/game/ui/btn_red.png'),
  green: require('../../assets/game/ui/btn_green.png'),
  yellow: require('../../assets/game/ui/btn_yellow.png'),
  joyBase: require('../../assets/game/ui/joy_base.png'),
  joyKnob: require('../../assets/game/ui/joy_knob.png'),
};
// 타점 존 → 3버튼의 실제 샷 라벨 (조작은 attack/rally/drop 그대로, 라벨만 상황을 말한다)
// mid = 수비 존: 깔려 오는 공(스매시·드라이브)을 받아치는 드라이브/언더/블록
type ShotZone = 'high' | 'mid' | 'net';
const ZONE_BTNS: Record<ShotZone, { atk: string; ral: string; drp: string }> = {
  high: { atk: '스매시', ral: '클리어', drp: '커트' },
  mid: { atk: '드라이브', ral: '언더', drp: '블록' },
  net: { atk: '푸시', ral: '언더', drp: '헤어핀' },
};

const SERVE_PERIOD = 1400; // 게이지 왕복 주기 — 사람이 PERFECT를 노릴 수 있는 속도
const servePhase = (now: number) => Math.abs(Math.sin((Math.PI * (now % SERVE_PERIOD)) / SERVE_PERIOD));

const SHOT_KO: Record<ShotType, string> = {
  clear: '클리어',
  smash: '스매시',
  drop: '드롭',
  hairpin: '헤어핀',
  lift: '언더클리어',
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
  zone: ShotZone; // 오는 공의 타점 존 — 버튼 라벨이 상황 따라 바뀐다
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
  const [charSel, setCharSel] = useState<'male' | 'female'>('male');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [ui, setUi] = useState<UiSnap | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [lefty, setLefty] = useState(false); // 왼손 모드 — 조작 배치 + 왼손잡이 캐릭터(백핸드 방향)
  useEffect(() => {
    if (simRef.current) simRef.current.leftHand = lefty;
  }, [lefty]);
  const [fontsLoaded] = useFonts({ Jua_400Regular });
  const jua = fontsLoaded ? 'Jua_400Regular' : undefined;

  // ── PvP — /lab/rally?match=<id>&role=host|guest 로 진입하면 네트워크 대전 ──
  const params = useLocalSearchParams<{ match?: string; role?: string }>();
  const pvpMatch = typeof params.match === 'string' && params.match ? params.match : undefined;
  const isPvp = !!pvpMatch;
  const isGuest = isPvp && params.role === 'guest';
  const oppLabel = isPvp ? '상대' : 'AI';
  const [oppLeft, setOppLeft] = useState(false);
  const netRef = useRef<RallyNet | null>(null);
  const remoteJoyRef = useRef({ dx: 0, dy: 0 }); // 호스트가 받는 게스트 스틱(월드 프레임)
  const oppTargetRef = useRef<{ x: number; y: number } | null>(null); // 게스트의 상대 보간 목표
  const lastSnapSentRef = useRef(0);

  const simRef = useRef<SimState | null>(null);
  const joyRef = useRef({ dx: 0, dy: 0 });
  const uiKeyRef = useRef('');
  const lastShotKeyRef = useRef('');
  const prevAnimRef = useRef({ p: 'idle', a: 'idle', pw: false, aw: false });
  const shuttleHist = useRef<{ x: number; y: number; t: number }[]>([]);
  const pRigRef = useRef<RigHandle>(null); // 내 캐릭터 리그 — 샷별 스윙 클립 재생
  const aRigRef = useRef<RigHandle>(null);
  const zoneRef = useRef<ShotZone>('high');

  // PvP 진입: sim 생성(호스트=권위 pvp sim, 게스트=스냅샷 미러 프레임) + 소켓 룸 연결
  useEffect(() => {
    if (!pvpMatch) return;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    const pvpCfg: MatchConfig = { target: 11, deuce: true, difficulty: 'normal' };
    setCfg(pvpCfg);
    const s = createSim(pvpCfg);
    s.leftHand = false; // PvP는 우선 오른손 기준(프로토콜 확장 전)
    if (isGuest) {
      s.server = 'ai'; // 첫 서브는 호스트 — 게스트 프레임에선 상대(ai)
    } else {
      s.pvp = true;
    }
    simRef.current = s;
    uiKeyRef.current = '';
    setUi(null);
    setOppLeft(false);
    setGuideOpen(true);
    setScreen('game');

    const net = connectRally(pvpMatch, userId, {
      onInput: isGuest
        ? undefined
        : (msg) => {
            const sim = simRef.current;
            if (!sim || !msg) return;
            // 게스트는 자기 뷰 프레임으로 보낸다 — 월드로 부호 반전
            if (msg.t === 'joy') remoteJoyRef.current = { dx: -msg.dx, dy: -msg.dy };
            else if (msg.t === 'swing') swingRemote(sim, msg.intent, msg.aim === 'auto' ? 'auto' : -msg.aim, msg.depth ?? 0);
            else if (msg.t === 'serve') serveRemote(sim, msg.kind, msg.gauge);
            else if (msg.t === 'again' && sim.phase === 'over') {
              const ns = createSim(pvpCfg);
              ns.pvp = true;
              simRef.current = ns;
              uiKeyRef.current = '';
            }
          },
      onSnapshot: isGuest
        ? (snap) => {
            const sim = simRef.current;
            if (!sim || !snap) return;
            applySnapshot(sim, snap);
            oppTargetRef.current = { x: snap.ai.x, y: snap.ai.y };
          }
        : undefined,
      // 게임이 이미 끝났으면 정상 이탈 — 결과 화면 위에 배너를 덮지 않는다
      onOpponentLeft: () => {
        if (simRef.current?.phase !== 'over') setOppLeft(true);
      },
    });
    netRef.current = net;
    return () => {
      net.dispose();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvpMatch, isGuest]);

  const proj: Projector | null = useMemo(
    () => (area.w > 0 ? makeProjector(area.w, area.h) : null),
    [area.w, area.h],
  );
  const projRef = useRef<Projector | null>(null);
  projRef.current = proj;

  // ── 공유값 ────────────────────────────────────────────────────────
  const pX = useSharedValue(0), pY = useSharedValue(0), pS = useSharedValue(1);
  const aX = useSharedValue(0), aY = useSharedValue(0), aS = useSharedValue(0.5);
  const pPose = useSharedValue(0), aPose = useSharedValue(0);
  const overPose = useSharedValue(0), overRun = useSharedValue(0); // 결과 화면 정지 포즈용
  const pRun = useSharedValue(0), aRun = useSharedValue(0);
  const pFace = useSharedValue(1), aFace = useSharedValue(1);
  const shX = useSharedValue(0), shY = useSharedValue(0), shS = useSharedValue(1);
  const shRot = useSharedValue(0), shOn = useSharedValue(0);
  const shFar = useSharedValue(0); // 1 = 셔틀이 상대 코트(네트 뒤에 그린다)
  const g1X = useSharedValue(0), g1Y = useSharedValue(0), g1On = useSharedValue(0);
  const g2X = useSharedValue(0), g2Y = useSharedValue(0), g2On = useSharedValue(0);
  const shadX = useSharedValue(0), shadY = useSharedValue(0), shadO = useSharedValue(0);
  const mkX = useSharedValue(0), mkY = useSharedValue(0), mkS = useSharedValue(1), mkOn = useSharedValue(0);
  const mk2X = useSharedValue(0), mk2Y = useSharedValue(0), mk2S = useSharedValue(1), mk2On = useSharedValue(0);
  const mkPulse = useSharedValue(0);
  const chanceOn = useSharedValue(0);
  const bobT = useSharedValue(0);
  const laneOn = useSharedValue(0), aimLaneSV = useSharedValue(0);
  const gauge = useSharedValue(0);
  const shakeT = useSharedValue(1), flashT = useSharedValue(0);
  const prevShuttleScreen = useRef({ x: 0, y: 0 });
  const streakRef = useRef(0);

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
      if (isGuest) {
        // 게스트: sim 미실행 — 로컬 예측(내 이동) + 스냅샷 재생만
        guestTick(s, dt, joyRef.current, oppTargetRef.current);
        netRef.current?.sendJoy(joyRef.current.dx, joyRef.current.dy);
      } else {
        tick(s, dt, joyRef.current, s.pvp ? remoteJoyRef.current : undefined);
        if (s.pvp && netRef.current && now - lastSnapSentRef.current >= 83) {
          lastSnapSentRef.current = now; // ~12Hz — 지연은 셔틀 비행시간에 숨는다
          netRef.current.sendSnapshot(makeSnapshot(s));
        }
      }

      // 캐릭터 위치·모션
      pX.value = p.x(s.player.x, s.player.y);
      pY.value = p.y(s.player.y, 0);
      pS.value = p.scale(s.player.y);
      aX.value = p.x(s.ai.x, s.ai.y);
      aY.value = p.y(s.ai.y, 0);
      aS.value = p.scale(s.ai.y);
      const step = Math.min(dt, 50);
      pPose.value = s.player.anim === 'swing' ? 2 : s.player.anim === 'lunge' ? 3 : s.player.moving ? 1 : 0;
      aPose.value = s.ai.anim === 'swing' ? 2 : s.ai.anim === 'lunge' ? 3 : s.ai.moving ? 1 : 0;
      if (s.player.moving) pRun.value += step * 0.009;
      if (s.ai.moving) aRun.value += step * 0.008;
      pFace.value = s.player.facing;
      aFace.value = s.ai.facing;
      // 득점 세리머니 — 배너 동안 승자는 cheer 포즈
      if (s.banner) {
        if (s.banner.winner === 'player') pPose.value = 4;
        else aPose.value = 4;
      }
      // 샷별 스윙 클립 재생 — sim이 정한 모션(Actor.motion)을 리그에 지시
      if (s.player.anim !== prevAnimRef.current.p) {
        if (s.player.anim === 'swing') pRigRef.current?.play(s.player.motion ?? 'overhead');
        else if (s.player.anim === 'lunge') pRigRef.current?.play('lunge');
        prevAnimRef.current.p = s.player.anim;
      }
      if (s.ai.anim !== prevAnimRef.current.a) {
        if (s.ai.anim === 'swing') aRigRef.current?.play(s.ai.motion ?? 'overhead');
        else if (s.ai.anim === 'lunge') aRigRef.current?.play('lunge');
        prevAnimRef.current.a = s.ai.anim;
      }
      // 백스윙 준비 — 오는 공이 가까우면 미리 젖히고, 스윙 없이 지나가면 풀기
      const pw = !!s.player.windup;
      if (pw !== prevAnimRef.current.pw) {
        if (pw) pRigRef.current?.play('windup');
        else if (s.player.anim === 'idle') pRigRef.current?.play('relax');
        prevAnimRef.current.pw = pw;
      }
      const aw = !!s.ai.windup;
      if (aw !== prevAnimRef.current.aw) {
        if (aw) aRigRef.current?.play('windup');
        else if (s.ai.anim === 'idle') aRigRef.current?.play('relax');
        prevAnimRef.current.aw = aw;
      }

      // 셔틀 + 그림자 + 트레일
      const sx = p.x(s.shuttle.x, s.shuttle.y);
      const sy = p.y(s.shuttle.y, s.shuttle.z);
      shX.value = sx;
      shY.value = sy;
      // 높이 스케일 — 높이 뜬 셔틀은 카메라에 가까워 살짝 커진다 (아크 가독성)
      shS.value = p.scale(s.shuttle.y) * (1 + s.shuttle.z * 0.05);
      shOn.value = s.phase === 'rally' || s.phase === 'serve' ? 1 : 0;
      shFar.value = s.shuttle.y > 0 ? 1 : 0; // 상대 코트에 있으면 네트 뒤 레이어에
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
        const smashing = s.traj.shot === 'smash';
        if (h1) { g1X.value = h1.x; g1Y.value = h1.y; g1On.value = smashing ? 0.5 : 0.3; } else g1On.value = 0;
        if (h2) { g2X.value = h2.x; g2Y.value = h2.y; g2On.value = smashing ? 0.26 : 0.14; } else g2On.value = 0;
      } else {
        hist.length = 0;
        g1On.value = 0;
        g2On.value = 0;
      }

      // 낙하 마커 — 내게 오는 공(골드), 내가 보낸 공(화이트, 코스 학습용)
      if (s.phase === 'rally' && s.traj && s.traj.by === 'ai' && s.traj.landing === 'in') {
        mkOn.value = 1;
        mkX.value = p.x(s.traj.p2.x, s.traj.p2.y);
        mkY.value = p.y(s.traj.p2.y, 0);
        mkS.value = p.scale(s.traj.p2.y);
        chanceOn.value = s.traj.chance ? 1 : 0; // 뜬공 = 스매시 찬스 알림
      } else {
        mkOn.value = 0;
        chanceOn.value = 0;
      }
      bobT.value += step * 0.005; // 아이들 숨쉬기
      if (s.phase === 'rally' && s.traj && s.traj.by === 'player' && s.traj.landing === 'in') {
        mk2On.value = 1;
        mk2X.value = p.x(s.traj.p2.x, s.traj.p2.y);
        mk2Y.value = p.y(s.traj.p2.y, 0);
        mk2S.value = p.scale(s.traj.p2.y);
      } else {
        mk2On.value = 0;
      }

      // 조준 레인
      laneOn.value = s.phase === 'rally' ? 1 : 0;
      const jdx = joyRef.current.dx;
      aimLaneSV.value = jdx > 0.35 ? 1 : jdx < -0.35 ? -1 : s.ai.x > 0.15 ? -1 : s.ai.x < -0.15 ? 1 : 0;

      // 서브 게이지
      if (s.phase === 'serve' && s.server === 'player') gauge.value = servePhase(now);

      // 타점 존 — 버튼 라벨용. 공이 내 코트로 넘어오면 '실제 셔틀 높이' 기준으로
      // 실시간 갱신 (라벨과 실제 샷이 어긋나던 문제 해소: 높을 때만 스매시,
      // 깔려 오면 수비 존 = 드라이브/언더/블록). 넘어오기 전엔 궤적으로 예보.
      if (s.phase === 'rally' && s.traj && s.traj.by === 'ai') {
        const sh = s.shuttle;
        if (sh.y < 0.5) {
          zoneRef.current =
            Math.abs(sh.y) <= 2.5 && sh.z < 1.5 ? 'net' : sh.z >= 1.5 ? 'high' : 'mid';
        } else {
          const tj = s.traj;
          zoneRef.current = Math.abs(tj.p2.y) <= 2.5 ? 'net' : tj.c.z < 2.3 ? 'mid' : 'high';
        }
      } else if (s.phase !== 'rally') {
        zoneRef.current = 'high';
      }

      // 저빈도 UI 동기화
      const key = [
        s.phase, s.score.player, s.score.ai, s.server, s.deuce, s.rallyLen,
        s.banner ? s.banner.reason : '', s.winner ?? '', zoneRef.current,
        s.lastShot ? `${s.lastShot.shot}${s.lastShot.quality}${s.lastShot.whiff ? 'w' : ''}` : '',
      ].join('|');
      if (key !== uiKeyRef.current) {
        uiKeyRef.current = key;
        setUi({
          phase: s.phase, score: { ...s.score }, server: s.server, deuce: s.deuce,
          rallyLen: s.rallyLen, banner: s.banner ? { ...s.banner } : null,
          winner: s.winner, lastShot: s.lastShot ? { ...s.lastShot } : null,
          stats: { ...s.stats }, zone: zoneRef.current,
        });
        if (s.banner) {
          haptic(s.banner.winner === 'player' ? 'success' : 'error');
          // 득점 순간 — 강한 셰이크
          shakeT.value = 0;
          shakeT.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) });
        }
        const lsKey = s.lastShot ? `${s.rallyLen}|${s.lastShot.shot}|${s.lastShot.quality}|${s.lastShot.whiff ? 'w' : ''}` : '';
        const myShot = !s.lastShot?.by || s.lastShot.by === 'player'; // PvP: 팝업은 내 스윙만
        if (s.lastShot && myShot && lsKey !== lastShotKeyRef.current && s.phase === 'rally') {
          lastShotKeyRef.current = lsKey;
          const q = s.lastShot.quality;
          const handKo = s.lastShot.hand === 'back' ? '백핸드 ' : s.lastShot.hand === 'round' ? '라운드 ' : '';
          const base = handKo + (s.lastShot.cut ? '커트' : SHOT_KO[s.lastShot.shot]);
          const shotName = s.lastShot.cross ? `크로스 ${base}` : base;
          const badText = s.lastShot.weak === 'late' ? '타점 낮음!' : '겨우 받았다!';
          // 퍼펙트 콤보 스트릭
          if (!s.lastShot.whiff && !s.lastShot.serve && q === 'perfect') streakRef.current += 1;
          else streakRef.current = 0;
          const streak = streakRef.current;
          // 타격감 — 스매시/퍼펙트에 셰이크, 퍼펙트에 플래시
          if (!s.lastShot.whiff && (q === 'perfect' || s.lastShot.shot === 'smash')) {
            shakeT.value = 0;
            shakeT.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) });
          }
          if (!s.lastShot.whiff && q === 'perfect') {
            flashT.value = 0.15;
            flashT.value = withTiming(0, { duration: 260 });
          }
          setPopup({
            key: now,
            text: s.lastShot.whiff
              ? '헛스윙!'
              : s.lastShot.serve
                ? q === 'perfect' ? '퍼펙트 서브!' : q === 'bad' ? '흔들린 서브…' : '서브'
                : q === 'perfect'
                  ? streak >= 2 ? `퍼펙트 x${streak}!` : `${shotName}!`
                  : q === 'good' ? shotName : badText,
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
  }, [screen, isGuest]);

  // ── 조작 ──────────────────────────────────────────────────────────
  // 코스 = 스윙 순간의 스틱 벡터: 좌우는 연속(끝까지 = 사이드라인 와이드),
  // 앞으로 밀며 치면 짧게 / 당기며 치면 깊게. 중립이면 빈 코트 오토.
  const doSwing = (intent: SwingIntent) => {
    const s = simRef.current;
    if (!s) return;
    const { dx: jdx, dy: jdy } = joyRef.current;
    const aim: AimLane = Math.abs(jdx) > 0.22 ? Math.max(-1, Math.min(1, jdx * 1.25)) : 'auto';
    const depth: AimDepth = jdy > 0.45 ? -1 : jdy < -0.45 ? 1 : 0;
    if (isGuest) {
      // 판정은 호스트에서 — 스윙 모션만 즉시(체감), 결과는 스냅샷으로
      netRef.current?.sendSwing(intent, aim, depth);
      s.player.anim = 'swing';
      s.player.animUntil = s.clock + 220;
      // 로컬 모션 추정 — 현재 타점 존으로 근사 (실제 판정 모션은 스냅샷에 실려온다)
      const z = zoneRef.current;
      s.player.motion =
        intent === 'attack' ? (z === 'high' ? 'smashJump' : z === 'mid' ? 'drive' : 'netPush')
        : intent === 'drop' ? (z === 'high' ? 'overhead' : 'netPush')
        : z === 'high' ? 'overhead' : 'under';
    } else {
      swingPlayer(s, intent, aim, depth);
    }
    haptic('light');
  };
  const doServe = (kind: 'short' | 'long') => {
    const s = simRef.current;
    if (!s) return;
    const phase = servePhase(Date.now());
    if (isGuest) {
      netRef.current?.sendServe(kind, phase);
      s.player.anim = 'swing';
      s.player.animUntil = s.clock + 240;
    } else {
      servePlayer(s, kind, phase);
    }
    haptic('light');
  };

  if (Platform.OS === 'web') {
    (globalThis as unknown as Record<string, unknown>).__rally = {
      state: () => simRef.current,
      swing: doSwing,
      serve: doServe,
      setJoy: (dx: number, dy: number) => { joyRef.current = { dx, dy }; },
      step: (dt: number) => {
        const s = simRef.current;
        if (s) tick(s, dt, joyRef.current, s.pvp ? remoteJoyRef.current : undefined);
      },
      net: () => netRef.current, // PvP 검증용 — 숨김 탭에서도 직접 송신 가능
      snap: () => (simRef.current ? makeSnapshot(simRef.current) : null), // 호스트 헤드리스 스냅샷
      rig: (m: RigClip) => pRigRef.current?.play(m), // 스윙 클립 시각 검증용
    };
  }

  // 조이스틱 — 플로팅: 왼쪽 영역 아무 데나 터치하면 그 자리에 생긴다.
  // 고정 스틱이 근경 코트(낙하 지점)를 가리던 문제의 해법 — 평소엔 흐릿한 힌트만.
  const knobX = useSharedValue(0), knobY = useSharedValue(0);
  const joyBaseX = useSharedValue(0), joyBaseY = useSharedValue(0), joyOn = useSharedValue(0);
  const joyGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      joyBaseX.value = e.x;
      joyBaseY.value = e.y;
      knobX.value = 0;
      knobY.value = 0;
      joyOn.value = withTiming(1, { duration: 90 });
    })
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
      joyOn.value = withTiming(0, { duration: 160 });
      joyRef.current = { dx: 0, dy: 0 };
    });

  // ── 애니메이티드 스타일 ───────────────────────────────────────────
  // 캐릭터 스케일 1.05 — 코트 대비 너무 크지 않게(셔틀·코트 가독) + 아이들 숨쉬기
  const playerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pX.value - 39 },
      { translateY: pY.value - 112 + (pPose.value === 0 ? Math.sin(bobT.value) * 2.2 : 0) },
      { scale: pS.value * 1.05 },
      { scaleX: pFace.value },
    ],
  }));
  const aiStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: aX.value - 39 },
      { translateY: aY.value - 112 + (aPose.value === 0 ? Math.sin(bobT.value + 1.7) * 2.2 : 0) },
      { scale: aS.value * 1.05 },
      { scaleX: aFace.value },
    ],
  }));
  const shakeStyle = useAnimatedStyle(() => {
    const t = shakeT.value;
    const amp = 7 * (1 - t);
    return { transform: [{ translateX: Math.sin(t * 34) * amp }, { translateY: Math.cos(t * 27) * amp * 0.6 }] };
  });
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashT.value }));
  // 셔틀·트레일은 네트 앞/뒤 복제 렌더 — shFar가 어느 쪽을 켤지 정한다 (진짜 깊이)
  const shuttleFarStyle = useAnimatedStyle(() => ({
    opacity: shOn.value * shFar.value,
    transform: [
      { translateX: shX.value - 13 },
      { translateY: shY.value - 26 },
      { scale: Math.max(0.5, shS.value) },
      { rotate: `${shRot.value}rad` },
    ],
  }));
  const shuttleNearStyle = useAnimatedStyle(() => ({
    opacity: shOn.value * (1 - shFar.value),
    transform: [
      { translateX: shX.value - 13 },
      { translateY: shY.value - 26 },
      { scale: Math.max(0.5, shS.value) },
      { rotate: `${shRot.value}rad` },
    ],
  }));
  const ghost1FarStyle = useAnimatedStyle(() => ({
    opacity: g1On.value * shOn.value * shFar.value,
    transform: [{ translateX: g1X.value - 10 }, { translateY: g1Y.value - 20 }, { scale: 0.8 * Math.max(0.5, shS.value) }],
  }));
  const ghost1NearStyle = useAnimatedStyle(() => ({
    opacity: g1On.value * shOn.value * (1 - shFar.value),
    transform: [{ translateX: g1X.value - 10 }, { translateY: g1Y.value - 20 }, { scale: 0.8 * Math.max(0.5, shS.value) }],
  }));
  const ghost2FarStyle = useAnimatedStyle(() => ({
    opacity: g2On.value * shOn.value * shFar.value,
    transform: [{ translateX: g2X.value - 8 }, { translateY: g2Y.value - 17 }, { scale: 0.62 * Math.max(0.5, shS.value) }],
  }));
  const ghost2NearStyle = useAnimatedStyle(() => ({
    opacity: g2On.value * shOn.value * (1 - shFar.value),
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
  const marker2Style = useAnimatedStyle(() => ({
    opacity: mk2On.value * 0.75,
    transform: [{ translateX: mk2X.value - 14 }, { translateY: mk2Y.value - 6 }, { scale: mk2S.value }],
  }));
  const chanceStyle = useAnimatedStyle(() => ({
    opacity: chanceOn.value * mkOn.value,
    transform: [{ translateX: mkX.value - 30 }, { translateY: mkY.value - 34 }, { scale: 1 + mkPulse.value * 0.12 }],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));
  const joyBaseStyle = useAnimatedStyle(() => ({
    opacity: joyOn.value,
    transform: [{ translateX: joyBaseX.value - 56 }, { translateY: joyBaseY.value - 56 }],
  }));
  const joyHintStyle = useAnimatedStyle(() => ({ opacity: (1 - joyOn.value) * 0.35 }));
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
        charSel={charSel}
        onCharSel={setCharSel}
        onStart={() => {
          simRef.current = createSim(cfg);
          simRef.current.leftHand = lefty;
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
    <View style={{ flex: 1, backgroundColor: '#EAF4FB' }}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <BackButton />
        <View style={{ flex: 1 }} />
        {/* 왼손/오른손 전환 — 조이스틱과 샷 버튼 좌우 교체 */}
        <Pressable onPress={() => setLefty((v) => !v)} hitSlop={8} style={{ marginRight: spacing.md }}>
          <MaterialCommunityIcons
            name={lefty ? 'hand-back-left' : 'hand-back-right'}
            size={21}
            color="#5A6B7E"
          />
        </Pressable>
        <Pressable onPress={() => (isPvp ? router.back() : setScreen('config'))} hitSlop={8}>
          <Icon name="close" size={22} color="#5A6B7E" />
        </Pressable>
      </View>

      <View style={styles.arenaWrap}>
        <View
          style={styles.arena}
          onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          <Animated.View style={[StyleSheet.absoluteFill, shakeStyle]} pointerEvents="none">
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
          <Animated.View style={[styles.marker2, marker2Style]} pointerEvents="none" />
          <Animated.View style={[styles.chanceTag, chanceStyle]} pointerEvents="none">
            <Text style={[styles.chanceTagText, juaStyle]}>찬스!</Text>
          </Animated.View>

          {/* 셔틀 그림자 */}
          <Animated.View style={[styles.shuttleShadow, shadowStyle]} pointerEvents="none" />

          {/* ── 원경 레이어: 상대 + 상대 코트의 셔틀 (네트 뒤) ── */}
          <Animated.View style={[styles.char, aiStyle]} pointerEvents="none">
            <RigCharacter ref={aRigRef} variant="oppo" poseMode={aPose} runFrame={aRun} />
          </Animated.View>
          <Animated.View style={[styles.fx, ghost2FarStyle]} pointerEvents="none"><ShuttleSvg size={23} /></Animated.View>
          <Animated.View style={[styles.fx, ghost1FarStyle]} pointerEvents="none"><ShuttleSvg size={26} /></Animated.View>
          <Animated.View style={[styles.fx, shuttleFarStyle]} pointerEvents="none">
            <View style={styles.shuttleHalo} />
            <ShuttleSvg size={31} />
          </Animated.View>

          {/* ── 네트 — 원경과 근경 사이 ── */}
          {proj && <CourtNet proj={proj} />}

          {/* ── 근경 레이어: 내 코트의 셔틀 + 나 (네트 앞) ── */}
          <Animated.View style={[styles.fx, ghost2NearStyle]} pointerEvents="none"><ShuttleSvg size={23} /></Animated.View>
          <Animated.View style={[styles.fx, ghost1NearStyle]} pointerEvents="none"><ShuttleSvg size={26} /></Animated.View>
          <Animated.View style={[styles.fx, shuttleNearStyle]} pointerEvents="none">
            <View style={styles.shuttleHalo} />
            <ShuttleSvg size={31} />
          </Animated.View>
          <Animated.View style={[styles.char, playerStyle]} pointerEvents="none">
            <RigCharacter ref={pRigRef} variant={charSel} poseMode={pPose} runFrame={pRun} />
          </Animated.View>
          </Animated.View>

          {/* 퍼펙트 플래시 */}
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, flashStyle]} pointerEvents="none" />

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
                <Text style={styles.sideName}>{oppLabel}</Text>
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
              oppLabel={oppLabel}
              jua={jua}
            />
          )}

          {/* 플로팅 조이스틱 — 터치한 자리에 생기고, 평소엔 흐릿한 힌트만 (코트 시야 확보) */}
          <GestureDetector gesture={joyGesture}>
            <View style={[styles.joyZone, lefty ? { right: 0 } : { left: 0 }, ui?.phase === 'serve' && { opacity: 0.35 }]}>
              <Animated.View style={[styles.joyHint, lefty ? { right: 40 } : { left: 40 }, joyHintStyle]} pointerEvents="none">
                <MaterialCommunityIcons name="gesture-swipe" size={18} color="#5A6B7E" />
              </Animated.View>
              <Animated.View style={[styles.joyFloat, joyBaseStyle]} pointerEvents="none">
                <ImageBackground source={UI_IMG.joyBase} style={styles.joyBase} imageStyle={{ opacity: 0.55 }}>
                  <Animated.View style={knobStyle}>
                    <Image source={UI_IMG.joyKnob} style={styles.joyKnob} />
                  </Animated.View>
                </ImageBackground>
              </Animated.View>
            </View>
          </GestureDetector>

          {/* 샷 버튼 — 타점 존에 따라 실제 샷 라벨로 바뀐다 (조작은 3버튼 그대로) */}
          {!serving && ui?.phase !== 'over' && (
            <View style={styles.btnCluster} pointerEvents="box-none">
              <ShotButton size={62} img={UI_IMG.yellow} icon="water" label={ZONE_BTNS[ui?.zone ?? 'high'].drp} jua={jua} style={lefty ? { left: 30, bottom: 132 } : { right: 30, bottom: 132 }} onPress={() => doSwing('drop')} />
              <ShotButton size={70} img={UI_IMG.green} icon="arrow-up-bold" label={ZONE_BTNS[ui?.zone ?? 'high'].ral} jua={jua} style={lefty ? { left: 116, bottom: 48 } : { right: 116, bottom: 48 }} onPress={() => doSwing('rally')} />
              <ShotButton size={88} img={UI_IMG.red} icon="flash" label={ZONE_BTNS[ui?.zone ?? 'high'].atk} jua={jua} style={lefty ? { left: 16, bottom: 30 } : { right: 16, bottom: 30 }} onPress={() => doSwing('attack')} />
            </View>
          )}

          {/* 서브 UI */}
          {serving && (
            <View style={[styles.serveWrap, lefty ? { left: 14, right: undefined } : null]}>
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
              <Text style={styles.aiServeText}>{oppLabel} 서브…</Text>
            </View>
          )}

          {/* 첫 서브 전 조작 가이드 */}
          {guideOpen && ui?.phase === 'serve' && (
            <View style={styles.guideWrap}>
              <View style={styles.guideCard}>
                <Text style={[styles.guideTitle, juaStyle]}>조작법</Text>
                <Text style={styles.guideRow}>🕹  왼손 조이스틱 — 이동 · 기울인 채 치면 그 방향 코스</Text>
                <Text style={styles.guideRow}>⚡  공이 높으면 스매시 — 깔려 오면 버튼이 수비(드라이브/언더/블록)로 바뀌어요</Text>
                <Text style={styles.guideRow}>⬆  클리어/언더 — 높고 깊게 올려 시간 벌기</Text>
                <Text style={styles.guideRow}>💧  높은 타점 커트 · 낮은 공 블록 · 네트 앞 헤어핀</Text>
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
          <View style={[styles.overCard, { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D3E8E2' }, shadows.sm]}>
            <View style={styles.overRankRow}>
              <View style={styles.overChar}>
                <RigCharacter variant={charSel} poseMode={overPose} runFrame={overRun} still={ui.winner === 'player' ? 'win' : 'lose'} />
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={[styles.overRank, juaStyle, { color: ui.winner === 'player' ? '#EAB308' : '#94A3B8' }]}>
                  {ui.winner === 'player' ? (ui.score.player - ui.score.ai >= 5 ? 'S' : 'A') : ui.score.player - ui.score.ai >= -2 ? 'B' : 'C'}
                </Text>
                <Text style={styles.overRankLabel}>등급</Text>
              </View>
            </View>
            <Text style={[styles.overTitle, { color: '#0F172A' }, juaStyle]}>
              {ui.winner === 'player' ? '승리!' : '패배…'}
            </Text>
            <Text style={[styles.overScore, { color: '#0F172A' }, juaStyle]}>
              {ui.score.player} : {ui.score.ai}
            </Text>
            <Text style={[styles.overStat, { color: '#64748B' }]}>
              최장 랠리 {ui.stats.longestRally}구 · 퍼펙트 {ui.stats.perfects}회
            </Text>
            <Pressable
              style={[styles.againBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (isGuest) {
                  // 재시작 권위도 호스트 — 요청만 보내고 스냅샷으로 따라간다
                  netRef.current?.sendAgain();
                  showInfo('한 판 더 요청을 보냈어요');
                  return;
                }
                const ns = createSim(cfg);
                if (isPvp) ns.pvp = true;
                else ns.leftHand = lefty;
                simRef.current = ns;
                uiKeyRef.current = '';
                setUi(null);
              }}
            >
              <Text style={styles.againBtnText}>한 판 더</Text>
            </Pressable>
            <Pressable onPress={() => (isPvp ? router.back() : setScreen('config'))} hitSlop={8}>
              <Text style={[styles.exitText, { color: '#64748B' }]}>{isPvp ? '나가기' : '대결 설정으로'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* PvP: 상대 이탈 */}
      {oppLeft && (
        <View style={styles.overWrap}>
          <View style={[styles.overCard, { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D3E8E2' }, shadows.sm]}>
            <Text style={[styles.overTitle, { color: '#0F172A' }, juaStyle]}>상대가 나갔어요</Text>
            <Pressable style={[styles.againBtn, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
              <Text style={styles.againBtnText}>나가기</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── 샷 버튼 — Kenney UI Pack depth-gloss 라운드 버튼 ────────────────
function ShotButton({ size, img, icon, label, jua, style, onPress }: {
  size: number;
  img: number;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  jua?: string;
  style: { right?: number; left?: number; bottom: number };
  onPress: () => void;
}) {
  return (
    <Pressable
      onPressIn={onPress}
      style={({ pressed }) => [
        styles.shotBtn,
        { width: size, height: size, right: style.right, left: style.left, bottom: style.bottom },
        pressed && { transform: [{ scale: 0.9 }, { translateY: 2 }] },
      ]}
    >
      <ImageBackground source={img} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', paddingBottom: size * 0.08 }} resizeMode="stretch">
        <MaterialCommunityIcons name={icon} size={size * 0.34} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }} />
        <Text style={[styles.shotBtnLabel, { fontSize: size * 0.15 }, jua ? { fontFamily: jua } : null]}>{label}</Text>
      </ImageBackground>
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
function BigBanner({ text, mine, oppLabel = 'AI', jua }: { text: string; mine: boolean; oppLabel?: string; jua?: string }) {
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
        <Text style={[styles.bannerBig, { color: mine ? '#FFFFFF' : '#FFE1DC' }, jua ? { fontFamily: jua, fontStyle: 'normal' } : null]}>{text}</Text>
        <Text style={styles.bannerSub}>{mine ? '내 득점!' : `${oppLabel} 득점`}</Text>
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
  // 코트 판정과 동일하게 복식(바깥) 라인까지 — 폰 화면에서 코트를 넓게 쓴다
  const xA = Math.min(spots.targetSign * 0.12, spots.targetSign * COURT.HALF_W);
  const xB = Math.max(spots.targetSign * 0.12, spots.targetSign * COURT.HALF_W);
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
        <View key={i} style={{ position: 'absolute', backgroundColor: 'rgba(255,255,255,0.18)', ...st }} />
      ))}
      {server === 'player' && (
        <Text style={[styles.serviceBoxLabel, { left: cx - 40, top: cy - 8 }]}>서비스 박스</Text>
      )}
    </View>
  );
}

// ─── 대결 설정 ─────────────────────────────────────────────────────
function ConfigScreen({ cfg, onChange, charSel, onCharSel, onStart }: {
  cfg: MatchConfig;
  onChange: (c: MatchConfig) => void;
  charSel: 'male' | 'female';
  onCharSel: (c: 'male' | 'female') => void;
  onStart: () => void;
}) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'ai' | 'pvp'>('ai');
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
        {/* 모드 탭 — vs AI / 같은 정모 사람에게 대결 신청 */}
        <View style={[styles.seg, { borderColor: colors.border, marginBottom: spacing.lg }]}>
          {([{ v: 'ai' as const, label: 'vs AI' }, { v: 'pvp' as const, label: '대결 신청' }]).map((o) => (
            <Pressable
              key={o.v}
              style={[styles.segItem, mode === o.v && { backgroundColor: colors.primary }]}
              onPress={() => setMode(o.v)}
            >
              <Text style={[styles.segText, { color: mode === o.v ? '#fff' : colors.textSecondary }]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'pvp' ? (
          <PvpLobby />
        ) : (
        <>
        <View style={[styles.cfgCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.cfgTitle, { color: colors.text }]}>대결 설정</Text>
          <Seg
            label="내 캐릭터"
            options={[{ v: 'male' as const, label: '남자' }, { v: 'female' as const, label: '여자' }]}
            value={charSel}
            set={onCharSel}
          />
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
        </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── PvP 로비 — 같은 정모 대기자에게 대결 신청 ──────────────────────
function PvpLobby() {
  const { colors, shadows } = useTheme();
  // 내 정모: /users/me/status — 체크인 스토어와 달리 clubSessionId를 항상 준다
  const [clubSessionId, setClubSessionId] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  useEffect(() => {
    profileApi
      .getMyStatus()
      .then((res) => setClubSessionId(res.data?.clubSessionId ?? null))
      .catch(() => setClubSessionId(null))
      .finally(() => setStatusLoaded(true));
  }, []);
  const myId = useAuthStore((st) => st.user?.id);
  const [players, setPlayers] = useState<PlayerCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState<{ matchId: string; name: string } | null>(null);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  const load = useCallback(async () => {
    if (!clubSessionId) return;
    setLoading(true);
    try {
      const res = await clubSessionApi.getPlayers(clubSessionId);
      const list = (res.data ?? []) as PlayerCardData[];
      // 나 제외, 대기(AVAILABLE) 우선 정렬 — 게임 중인 사람은 뒤로
      list.sort((a, b) => (a.status === 'AVAILABLE' ? 0 : 1) - (b.status === 'AVAILABLE' ? 0 : 1));
      setPlayers(list.filter((p) => p.userId !== myId));
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, [clubSessionId, myId]);
  useEffect(() => {
    load();
  }, [load]);

  const challenge = async (p: PlayerCardData) => {
    const name = p.userName || p.name || '상대';
    try {
      const res = await rallyApi.challenge(p.userId);
      setWaiting({ matchId: res.data.matchId, name });
    } catch (e: any) {
      showError(e?.message || '신청에 실패했어요');
    }
  };

  // 수락되면 서버가 rally:matched를 쏜다(전역 user 룸) → 호스트로 게임 진입
  useSocketEvent(
    'rally:matched',
    useCallback((data: any) => {
      const w = waitingRef.current;
      if (!w || data?.matchId !== w.matchId) return;
      setWaiting(null);
      router.push(`/lab/rally?match=${data.matchId}&role=host`);
    }, []),
  );
  useSocketEvent(
    'rally:declined',
    useCallback((data: any) => {
      const w = waitingRef.current;
      if (!w || data?.matchId !== w.matchId) return;
      setWaiting(null);
      showInfo(`${w.name}님이 응하지 않았어요`);
    }, []),
  );

  if (!clubSessionId) {
    return (
      <View style={[styles.cfgCard, { backgroundColor: colors.surface, alignItems: 'center', gap: spacing.sm }, shadows.sm]}>
        {!statusLoaded ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <MaterialCommunityIcons name="qrcode-scan" size={30} color={colors.textLight} />
            <Text style={{ ...typography.body1, color: colors.textSecondary, textAlign: 'center' }}>
              정모에 체크인하면{'\n'}같은 정모 사람에게 대결을 신청할 수 있어요
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.cfgCard, { backgroundColor: colors.surface }, shadows.sm]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Text style={[styles.cfgTitle, { color: colors.text, marginBottom: 0 }]}>정모 대기자</Text>
        <Pressable onPress={load} hitSlop={8}>
          <MaterialCommunityIcons name="refresh" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.primary} />
      ) : players.length === 0 ? (
        <Text style={{ ...typography.body1, color: colors.textLight, textAlign: 'center', marginVertical: spacing.lg }}>
          대결할 수 있는 사람이 아직 없어요
        </Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {players.map((p) => (
            <View key={p.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <PlayerCard player={p} showGames={false} />
              </View>
              <Pressable
                style={[styles.challengeBtn, { backgroundColor: colors.primary }]}
                onPress={() => challenge(p)}
              >
                <MaterialCommunityIcons name="sword-cross" size={14} color="#fff" />
                <Text style={styles.challengeBtnText}>대결 신청</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Text style={{ ...typography.caption, color: colors.textLight, marginTop: spacing.md }}>
        11점 · 듀스 — 상대가 60초 안에 수락하면 바로 시작돼요
      </Text>

      {/* 수락 대기 오버레이 */}
      {waiting && (
        <View style={styles.waitingWrap}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.waitingText}>{waiting.name}님의 수락 대기 중…</Text>
          <Text style={styles.waitingSub}>60초 안에 응답이 없으면 자동 취소돼요</Text>
          <Pressable
            style={styles.waitingCancel}
            onPress={() => {
              const w = waitingRef.current;
              setWaiting(null);
              if (w) rallyApi.decline(w.matchId).catch(() => {});
            }}
          >
            <Text style={styles.waitingCancelText}>취소</Text>
          </Pressable>
        </View>
      )}
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
    backgroundColor: 'rgba(255,255,255,0.3)', borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.95)',
  },
  marker: {
    position: 'absolute', width: 36, height: 14, borderRadius: 18,
    borderWidth: 2.5, borderColor: '#FACC15', backgroundColor: 'rgba(250,204,21,0.2)',
  },
  marker2: {
    position: 'absolute', width: 28, height: 11, borderRadius: 14,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)', backgroundColor: 'rgba(255,255,255,0.22)',
  },
  chanceTag: {
    position: 'absolute', width: 60, paddingVertical: 2, borderRadius: 10,
    backgroundColor: '#F59E0B', alignItems: 'center',
  },
  chanceTagText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  shuttleShadow: {
    position: 'absolute', width: 20, height: 8, borderRadius: 10, backgroundColor: '#000',
  },
  // 셔틀 뒤 웜 옐로 글로우 — 초록 코트 위 가독성 (콕이 잘 안 보인다는 피드백)
  shuttleHalo: {
    position: 'absolute', left: -6, top: -6, width: 43, height: 43,
    borderRadius: 22, backgroundColor: 'rgba(255,215,80,0.42)',
  },

  char: { position: 'absolute', left: 0, top: 0 },
  fx: { position: 'absolute', left: 0, top: 0 },

  // 터치 영역은 넓게(46% × 320) — 시각 요소는 터치 전엔 힌트뿐. 좌우는 lefty로 결정
  joyZone: { position: 'absolute', bottom: 0, width: '46%', height: 320 },
  joyHint: {
    position: 'absolute', bottom: 46, width: 52, height: 52, borderRadius: 26,
    borderWidth: 2, borderColor: 'rgba(90,107,126,0.55)', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.25)',
  },
  joyFloat: { position: 'absolute', left: 0, top: 0, width: 112, height: 112 },
  joyBase: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  joyKnob: { width: 54, height: 54 },

  btnCluster: { ...StyleSheet.absoluteFillObject },
  shotBtn: { position: 'absolute' },
  shotBtnLabel: {
    color: '#fff', fontWeight: '700', marginTop: 0,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },

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

  serveWrap: { position: 'absolute', bottom: 26, right: 14, alignItems: 'center', gap: spacing.sm, width: 240 },
  gaugeTrack: { width: '100%', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: '#B9D2E4' },
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
  aiServeText: { color: '#3D5A73', fontSize: 13, fontWeight: '700' },
  serveCourtText: { color: '#0F766E', fontSize: 12, fontWeight: '700' },
  serviceBoxLabel: { position: 'absolute', width: 80, textAlign: 'center', fontSize: 10, fontWeight: '700', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },

  guideWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.35)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  guideCard: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#BEE3DA', padding: 20, gap: 9 },
  guideTitle: { color: '#0F172A', fontSize: 17, fontWeight: '700', marginBottom: 2 },
  guideRow: { color: '#475569', fontSize: 12.5, lineHeight: 19, fontWeight: '600' },
  guideBtn: { marginTop: 8, backgroundColor: '#14B8A6', borderRadius: 10, alignItems: 'center', paddingVertical: 11 },
  guideBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  overWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.35)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  overCard: { width: '100%', maxWidth: 340, borderRadius: radius.card, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  overRankRow: { flexDirection: 'row', alignItems: 'center', gap: 22, marginBottom: 2 },
  overChar: { width: 78, height: 112, transform: [{ scale: 0.86 }] },
  overRank: { fontSize: 56, lineHeight: 60, fontWeight: '700' },
  overRankLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', marginTop: -2 },
  overTitle: { ...typography.h2 },
  overScore: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  overStat: { ...typography.caption },
  againBtn: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.lg, marginTop: spacing.sm },
  againBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  exitText: { ...typography.caption, fontWeight: '600', marginTop: 2 },

  hint: { textAlign: 'center', fontSize: 11, color: '#6B7E90', paddingVertical: 8, paddingHorizontal: 16 },

  cfgCard: { borderRadius: radius.card, padding: spacing.xl },
  cfgTitle: { ...typography.h3, marginBottom: spacing.lg },
  cfgLabel: { ...typography.caption, fontWeight: '700', marginBottom: 6 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  segText: { fontSize: 14, fontWeight: '700' },
  cfgHint: { ...typography.caption, marginTop: spacing.md, textAlign: 'center', lineHeight: 18 },

  // PvP 로비
  challengeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg,
  },
  challengeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  waitingWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13,18,26,0.88)',
    borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    padding: spacing.xl,
  },
  waitingText: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  waitingSub: { color: '#94A3B8', fontSize: 12 },
  waitingCancel: {
    marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(148,163,184,0.5)',
  },
  waitingCancelText: { color: '#E2E8F0', fontSize: 13, fontWeight: '700' },
});
