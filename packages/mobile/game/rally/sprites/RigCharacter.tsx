/**
 * 콕고 랠리 — 리깅 캐릭터 (v4 아트 패스).
 *
 * 스프라이트 교체가 아니라 관절(어깨·팔꿈치·라켓·몸통·다리)이 실제로 회전하는
 * 리그. 샷마다 다른 스윙 클립(백스윙→임팩트→팔로스루)을 재생한다 — 정지 그림에
 * 라켓만 돌리던 어색함의 해법. 클립은 각도·시간 테이블(CLIPS)이라 손맛 조정이 쉽다.
 *
 * 렌더 규약(기존 KenneyCharacter와 동일한 틀):
 *  - 78×112 박스, 발이 박스 하단. 위치/스케일/좌우반전은 부모(rally.tsx)가 건다.
 *  - poseMode(0 idle/1 run/2 swing/3 lunge/4 cheer)·runFrame은 공유값 — 리렌더 없음.
 *  - 샷별 스윙은 ref.play(motion) 명령형 호출 (sim의 Actor.motion 값).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { MotionKey } from '../sim';

// ─── 리그 상수 ─────────────────────────────────────────────────────
const JOINTS = ['torso', 'armL', 'foreL', 'armR', 'foreR', 'racket', 'legL', 'legR'] as const;
type Joint = (typeof JOINTS)[number];

// 준비 자세: 라켓 헤드가 위로 서는 배드민턴 레디 스탠스 (손은 가슴 앞, 라켓은 얼굴 옆)
const REST: Record<Joint, number> = {
  torso: 0, armL: 7, foreL: 9, armR: -24, foreR: -70, racket: -55, legL: 2, legR: -2,
};

interface Frame {
  d: number; // ms
  j: Partial<Record<Joint, number>>; // 명시 안 한 관절은 직전 값 유지, 마지막 프레임은 REST 복귀
  y?: number; // rootY(점프/크라우치). 마지막 프레임 생략 시 0 복귀
}
interface Clip {
  f: Frame[];
  /** true면 마지막 프레임에서 멈춰 유지 (windup처럼 다음 클립을 기다리는 자세) */
  hold?: boolean;
}

// 샷별 스윙 클립.
// 타이밍 원칙: 공은 버튼 누른 순간 떠난다 → 임팩트가 press 후 ~60-100ms에 오도록
// 백스윙은 짧게, 팔로스루는 길게. 오는 공이 가까우면 windup이 미리 백스윙을 젖혀 놓는다.
const CLIPS: Record<string, Clip> = {
  // 공이 다가오면 자동 재생 — 라켓을 뒤로 젖히고 대기
  windup: { hold: true, f: [{ d: 110, j: { armR: -112, foreR: -100, racket: -48, torso: -7 } }] },
  // 공이 지나가면 준비 자세로 복귀
  relax: { f: [{ d: 180, j: {} }] },
  // 클리어/드롭·커트: (짧은) 백스윙 → 임팩트(팔 쭉) → 팔로스루
  overhead: { f: [
    { d: 60, j: { armR: -128, foreR: -108, racket: -52, torso: -7 } },
    { d: 70, j: { armR: -158, foreR: -6, racket: 10, torso: 8 } },
    { d: 180, j: { armR: -42, foreR: -24, racket: 14 } },
    { d: 160, j: {} },
  ] },
  // 스매시: 크라우치 → 점프 + 내려찍기 → 착지
  smashJump: { f: [
    { d: 90, j: { armR: -120, foreR: -118, racket: -58, torso: -10, legL: -16, legR: 14 }, y: 7 },
    { d: 90, j: { armR: -162, foreR: -4, racket: 14, torso: 11, legL: 4, legR: -4 }, y: -16 },
    { d: 160, j: { armR: -60, foreR: -24, racket: 26 }, y: -10 },
    { d: 200, j: {} },
  ] },
  // 리프트/롱서브: 아래에서 위로 퍼올리기
  under: { f: [
    { d: 70, j: { armR: 28, foreR: 18, racket: 40, torso: 6 } },
    { d: 100, j: { armR: -78, foreR: -30, racket: -24, torso: -4 } },
    { d: 210, j: {} },
  ] },
  // 헤어핀·푸시·숏서브: 런지 스텝과 함께 짧게 밀기
  netPush: { f: [
    { d: 80, j: { armR: -88, foreR: -6, racket: 6, torso: 9, legR: 24, legL: -14 } },
    { d: 110, j: { armR: -96, foreR: -2 } },
    { d: 180, j: {} },
  ] },
  // 드라이브: 옆에서 평평하게 후려치기
  drive: { f: [
    { d: 70, j: { armR: -66, foreR: -96, racket: -70, torso: -6 } },
    { d: 80, j: { armR: -108, foreR: 6, racket: 36, torso: 7 } },
    { d: 210, j: {} },
  ] },
  // ── 백핸드 — 미러가 아니라 몸 앞을 가로지르는 전용 스윙 (양수 회전 = 몸 건너편) ──
  // 백 오버헤드(백클리어·백드롭): 라켓을 반대 어깨로 감았다가 위로 크로스
  backOverhead: { f: [
    { d: 70, j: { armR: 35, foreR: 85, racket: 45, torso: 8 } },
    { d: 80, j: { armR: 128, foreR: 8, racket: -22, torso: -6 } },
    { d: 180, j: { armR: 60, foreR: 30, racket: 0, torso: 0 } },
    { d: 160, j: {} },
  ] },
  // 백 드라이브: 몸 앞 낮게 감았다가 평평하게 후려치기
  backDrive: { f: [
    { d: 70, j: { armR: 50, foreR: 95, racket: 62, torso: 7 } },
    { d: 80, j: { armR: 96, foreR: -8, racket: -58, torso: -6 } },
    { d: 210, j: {} },
  ] },
  // 백 언더(백 리프트): 반대쪽 아래에서 퍼올리기
  backUnder: { f: [
    { d: 70, j: { armR: 55, foreR: 40, racket: 30, torso: 7 } },
    { d: 100, j: { armR: 115, foreR: 10, racket: -30, torso: -4 } },
    { d: 210, j: {} },
  ] },
  // 백 네트(백 헤어핀/푸시): 반대쪽으로 짧게 밀기
  backNet: { f: [
    { d: 80, j: { armR: 78, foreR: 18, racket: 5, torso: 8, legL: 24, legR: -14 } },
    { d: 110, j: { armR: 88, foreR: 10 } },
    { d: 180, j: {} },
  ] },
  // 라운드 더 헤드: 백 쪽 높은 공을 머리 위로 돌아 포핸드로 — 몸이 기울며 강타
  round: { f: [
    { d: 80, j: { armR: -130, foreR: -110, racket: -50, torso: 6 } },
    { d: 80, j: { armR: -190, foreR: -10, racket: 16, torso: 14, legL: 12 } },
    { d: 170, j: { armR: -80, foreR: -30, torso: 5 } },
    { d: 160, j: {} },
  ] },
  // 런지: 다리 쫙 뻗고 낮게 리치 (배드 퀄리티 리턴)
  lunge: { f: [
    { d: 130, j: { armR: -98, foreR: 0, racket: 10, legR: 38, legL: -26, torso: 13 }, y: 9 },
    { d: 260, j: { armR: -98, foreR: 0, legR: 38, legL: -26, torso: 13 }, y: 9 },
    { d: 200, j: {} },
  ] },
  cheer: { f: [
    { d: 200, j: { armL: 160, armR: -160, foreR: -8, foreL: 0, racket: 10 } },
    { d: 250, j: { armL: 146, armR: -146 } },
    { d: 200, j: { armL: 160, armR: -160 } },
    { d: 250, j: {} },
  ] },
};

// 결과 화면용 정지 포즈
const STILLS: Record<'win' | 'lose', Partial<Record<Joint, number>> & { y?: number }> = {
  win: { armL: 160, armR: -160, foreR: -8, foreL: 0 },
  lose: { torso: 13, armR: -98, foreR: 0, legR: 38, legL: -26, y: 9 },
};

const EASE = Easing.out(Easing.quad);

// 스윙 스우시 — 라켓 궤적을 따라 번쩍이는 호. 스윙이 '휘둘러진다'고 읽히게 하는 핵심.
// start=시작 각도(deg), sweep=쓸고 가는 각도, cx/cy=호 중심(캐릭터 박스 기준)
const SWOOSH: Record<string, { cx: number; cy: number; start: number; sweep: number; r: number }> = {
  overhead: { cx: 39, cy: 26, start: -60, sweep: 150, r: 34 },
  smashJump: { cx: 39, cy: 22, start: -70, sweep: 170, r: 38 },
  under: { cx: 46, cy: 62, start: 150, sweep: -140, r: 30 },
  netPush: { cx: 52, cy: 52, start: 20, sweep: 70, r: 26 },
  drive: { cx: 48, cy: 46, start: -30, sweep: 120, r: 30 },
  round: { cx: 34, cy: 22, start: -80, sweep: 185, r: 38 },
  backOverhead: { cx: 30, cy: 28, start: 240, sweep: -150, r: 32 },
  backDrive: { cx: 30, cy: 46, start: 210, sweep: -120, r: 30 },
  backUnder: { cx: 30, cy: 60, start: 30, sweep: 140, r: 30 },
  backNet: { cx: 26, cy: 52, start: 160, sweep: -70, r: 26 },
};

// ─── 팔레트 ────────────────────────────────────────────────────────
type Variant = 'male' | 'female' | 'oppo';
const PAL: Record<Variant, { skin: string; hair: string; jersey: string; jerseyLine: string; shorts: string; band: string }> = {
  male: { skin: '#F3C89F', hair: '#4C3A2E', jersey: '#12A48E', jerseyLine: '#0C7A69', shorts: '#194A57', band: '#FFFFFF' },
  female: { skin: '#F6D2AC', hair: '#7B4A33', jersey: '#12A48E', jerseyLine: '#0C7A69', shorts: '#194A57', band: '#FFD34D' },
  oppo: { skin: '#EFC096', hair: '#33404C', jersey: '#E2695C', jerseyLine: '#B84A3E', shorts: '#33414F', band: '#FFFFFF' },
};

/** rig가 재생할 수 있는 클립 — 샷 모션 + 준비/복귀 */
export type RigClip = MotionKey | 'windup' | 'relax';

export interface RigHandle {
  play: (motion: RigClip) => void;
}

/** 클립의 tMs 시점 포즈 — 필름스트립 디버그(/lab/rig)용. play()와 동일한 보간 시맨틱 */
export function poseAt(motion: RigClip, tMs: number): { j: Record<string, number>; y: number } {
  const def = CLIPS[motion] ?? CLIPS.overhead;
  const clip = def.f;
  let prevJ: Record<Joint, number> = { ...REST };
  let prevY = 0;
  let acc = 0;
  for (let i = 0; i < clip.length; i++) {
    const f = clip[i];
    const isLast = i === clip.length - 1;
    const tgtJ = {} as Record<Joint, number>;
    for (const j of JOINTS) tgtJ[j] = f.j[j] !== undefined ? f.j[j]! : isLast && !def.hold ? REST[j] : prevJ[j];
    const tgtY = f.y !== undefined ? f.y : isLast && !def.hold ? 0 : prevY;
    if (tMs <= acc + f.d) {
      const k = Math.max(0, Math.min(1, (tMs - acc) / f.d));
      const pose = {} as Record<Joint, number>;
      for (const j of JOINTS) pose[j] = prevJ[j] + (tgtJ[j] - prevJ[j]) * k;
      return { j: pose, y: prevY + (tgtY - prevY) * k };
    }
    prevJ = tgtJ;
    prevY = tgtY;
    acc += f.d;
  }
  return { j: prevJ, y: prevY };
}

interface Props {
  variant: Variant;
  /** 0 idle / 1 run / 2 swing / 3 lunge / 4 cheer — 부모 루프가 갱신하는 공유값 */
  poseMode: SharedValue<number>;
  /** 러닝 위상 누적값 — 다리·팔 스윙 */
  runFrame: SharedValue<number>;
  /** 결과 화면용 정지 포즈 (지정 시 poseMode 무시) */
  still?: 'win' | 'lose';
  /** 임의 포즈 동결 — 필름스트립 디버그용 (poseAt 결과를 그대로) */
  freeze?: { j: Record<string, number>; y: number };
}

// 상단 가장자리를 축으로 회전 (RN 기본은 중심축)
const pivotTop = (h: number, deg: number) => {
  'worklet';
  return [{ translateY: -h / 2 }, { rotate: `${deg}deg` }, { translateY: h / 2 }];
};
const pivotBottom = (h: number, deg: number) => {
  'worklet';
  return [{ translateY: h / 2 }, { rotate: `${deg}deg` }, { translateY: -h / 2 }];
};

export const RigCharacter = forwardRef<RigHandle, Props>(function RigCharacter(
  { variant, poseMode, runFrame, still, freeze },
  ref,
) {
  const pal = PAL[variant];
  const front = variant === 'oppo';

  const torso = useSharedValue(REST.torso);
  const armL = useSharedValue(REST.armL);
  const foreL = useSharedValue(REST.foreL);
  const armR = useSharedValue(REST.armR);
  const foreR = useSharedValue(REST.foreR);
  const racket = useSharedValue(REST.racket);
  const legL = useSharedValue(REST.legL);
  const legR = useSharedValue(REST.legR);
  const rootY = useSharedValue(0);
  // 스우시 — 진행도(0→1)와 클립별 파라미터
  const swT = useSharedValue(1);
  const swStart = useSharedValue(0);
  const swSweep = useSharedValue(0);
  const swCx = useSharedValue(39);
  const swCy = useSharedValue(30);
  const swR = useSharedValue(32);
  const sv: Record<Joint, SharedValue<number>> = { torso, armL, foreL, armR, foreR, racket, legL, legR };

  useImperativeHandle(ref, () => ({
    play: (motion: RigClip) => {
      const { f: clip, hold } = CLIPS[motion] ?? CLIPS.overhead;
      for (const j of JOINTS) {
        let prev = REST[j];
        const seq = clip.map((f, i) => {
          const isLast = i === clip.length - 1;
          const target = f.j[j] !== undefined ? f.j[j]! : isLast && !hold ? REST[j] : prev;
          prev = target;
          return withTiming(target, { duration: f.d, easing: EASE });
        });
        sv[j].value = seq.length === 1 ? seq[0] : withSequence(seq[0], ...seq.slice(1));
      }
      let prevY = 0;
      const seqY = clip.map((f, i) => {
        const isLast = i === clip.length - 1;
        const target = f.y !== undefined ? f.y : isLast && !hold ? 0 : prevY;
        prevY = target;
        return withTiming(target, { duration: f.d, easing: EASE });
      });
      rootY.value = seqY.length === 1 ? seqY[0] : withSequence(seqY[0], ...seqY.slice(1));
      // 스우시 발동 — 백스윙 직후 임팩트 구간을 쓸고 간다
      const sw = SWOOSH[motion];
      if (sw) {
        swStart.value = sw.start;
        swSweep.value = sw.sweep;
        swCx.value = sw.cx;
        swCy.value = sw.cy;
        swR.value = sw.r;
        swT.value = 0;
        swT.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
      }
    },
  }));

  useEffect(() => {
    if (!still) return;
    const pose = STILLS[still];
    for (const j of JOINTS) sv[j].value = pose[j] ?? REST[j];
    rootY.value = pose.y ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => {
    if (!freeze) return;
    for (const j of JOINTS) sv[j].value = freeze.j[j] ?? REST[j];
    rootY.value = freeze.y ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze]);

  // ── 관절 스타일 — 러닝(다리·팔 펌프)과 cheer(양팔 위)는 공유값 오버라이드
  const rootStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rootY.value }] }));
  const torsoStyle = useAnimatedStyle(() => ({ transform: pivotBottom(34, torso.value) }));
  const legLStyle = useAnimatedStyle(() => {
    const r = poseMode.value === 1 ? Math.sin(runFrame.value * 6) * 30 : legL.value;
    return { transform: pivotTop(28, r) };
  });
  const legRStyle = useAnimatedStyle(() => {
    const r = poseMode.value === 1 ? Math.sin(runFrame.value * 6 + Math.PI) * 30 : legR.value;
    return { transform: pivotTop(28, r) };
  });
  const armLStyle = useAnimatedStyle(() => {
    const cheer = poseMode.value === 4;
    const pump = poseMode.value === 1 ? Math.sin(runFrame.value * 6 + Math.PI) * 16 : 0;
    return { transform: pivotTop(20, cheer ? 158 : armL.value + pump) };
  });
  const foreLStyle = useAnimatedStyle(() => ({
    transform: pivotTop(18, poseMode.value === 4 ? 0 : foreL.value),
  }));
  const armRStyle = useAnimatedStyle(() => {
    // 라켓 팔은 달릴 때도 펌프하지 않는다 — 레디 자세 유지 (라켓이 흔들리며 도는 느낌 방지)
    const cheer = poseMode.value === 4;
    return { transform: pivotTop(20, cheer ? -158 : armR.value) };
  });
  const foreRStyle = useAnimatedStyle(() => ({
    transform: pivotTop(18, poseMode.value === 4 ? -10 : foreR.value),
  }));
  const racketStyle = useAnimatedStyle(() => ({ transform: pivotTop(20, racket.value) }));
  const swooshStyle = useAnimatedStyle(() => ({
    opacity: swT.value >= 1 ? 0 : (1 - swT.value) * 0.85,
    left: swCx.value - swR.value,
    top: swCy.value - swR.value,
    width: swR.value * 2,
    height: swR.value * 2,
    borderRadius: swR.value,
    transform: [{ rotate: `${swStart.value + swSweep.value * swT.value}deg` }],
  }));

  // 정적 파트 스타일 (variant 색만 다름)
  const s = useMemo(() => makeStyles(pal), [pal]);

  return (
    <View style={s.box} pointerEvents="none">
      <View style={s.shadow} />
      <Animated.View style={[StyleSheet.absoluteFill, rootStyle]}>
        {/* 다리 */}
        <Animated.View style={[s.leg, { left: 26 }, legLStyle]}>
          <View style={s.foot} />
        </Animated.View>
        <Animated.View style={[s.leg, { left: 43 }, legRStyle]}>
          <View style={s.foot} />
        </Animated.View>
        {/* 목 (머리·몸통 뒤) */}
        <View style={s.neck} />
        {/* 몸통 */}
        <Animated.View style={[s.torso, torsoStyle]}>
          <View style={s.shorts} />
          <View style={s.jerseyLine} />
          {/* 머리 */}
          <View style={s.head}>
            <View style={front ? s.hairFront : s.hairBack} />
            {variant === 'female' && <View style={s.pony} />}
            <View style={[s.band, front && s.bandFront]} />
            {front && (
              <View style={s.face}>
                <View style={[s.eye, { left: 10 }]} />
                <View style={[s.eye, { right: 10 }]} />
                <View style={s.smile} />
              </View>
            )}
          </View>
          {/* 왼팔 */}
          <Animated.View style={[s.arm, { left: -7 }, armLStyle]}>
            <View style={s.sleeve} />
            <Animated.View style={[s.fore, foreLStyle]} />
          </Animated.View>
          {/* 오른팔 + 라켓 */}
          <Animated.View style={[s.arm, { left: 33 }, armRStyle]}>
            <View style={s.sleeve} />
            <Animated.View style={[s.fore, foreRStyle]}>
              <Animated.View style={[s.racket, racketStyle]}>
                <View style={s.racketHead}>
                  <View style={s.stringH} />
                  <View style={s.stringV} />
                </View>
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </Animated.View>
        {/* 스윙 스우시 — 라켓이 쓸고 간 궤적 */}
        <Animated.View style={[s.swoosh, swooshStyle]} pointerEvents="none" />
      </Animated.View>
    </View>
  );
});

function makeStyles(pal: (typeof PAL)['male']) {
  return StyleSheet.create({
    box: { width: 78, height: 112 },
    shadow: {
      position: 'absolute', left: 39 - 22, bottom: 0, width: 44, height: 9,
      borderRadius: 22, backgroundColor: 'rgba(10,30,45,0.22)',
    },
    // 다리를 길게 — 캐릭터가 '서 있는' 실루엣의 핵심
    leg: {
      position: 'absolute', top: 72, width: 9, height: 28, borderRadius: 5,
      backgroundColor: pal.skin,
    },
    foot: {
      position: 'absolute', bottom: -6, left: -3, width: 15, height: 8,
      borderRadius: 5, backgroundColor: '#FFFFFF',
      borderBottomWidth: 2, borderBottomColor: 'rgba(0,0,0,0.15)',
    },
    neck: { position: 'absolute', left: 35, top: 37, width: 8, height: 9, backgroundColor: pal.skin },
    torso: {
      position: 'absolute', left: 22, top: 42, width: 34, height: 34,
      borderRadius: 11, backgroundColor: pal.jersey,
    },
    shorts: {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: 10,
      borderBottomLeftRadius: 11, borderBottomRightRadius: 11, backgroundColor: pal.shorts,
    },
    jerseyLine: {
      position: 'absolute', left: 14, top: 3, width: 6, height: 17,
      borderRadius: 3, backgroundColor: pal.jerseyLine,
    },
    // 머리: 몸통과 같은 폭 — 버섯 실루엣 방지
    head: {
      position: 'absolute', left: 0, top: -30, width: 34, height: 32,
      borderRadius: 16, backgroundColor: pal.skin,
    },
    // 뒷모습: 뒤통수 전체가 머리카락 (맨살 노출 = 어색함의 원인)
    hairBack: {
      position: 'absolute', left: -2, right: -2, top: -2, bottom: -1,
      borderRadius: 17, backgroundColor: pal.hair,
    },
    hairFront: {
      position: 'absolute', left: -2, right: -2, top: -2, height: 14,
      borderTopLeftRadius: 17, borderTopRightRadius: 17, borderBottomLeftRadius: 5,
      borderBottomRightRadius: 5, backgroundColor: pal.hair,
    },
    pony: {
      position: 'absolute', left: 12, top: 6, width: 11, height: 30,
      borderRadius: 6, backgroundColor: pal.hair, transform: [{ rotate: '4deg' }], zIndex: 2,
    },
    band: {
      position: 'absolute', left: -2, right: -2, top: 12, height: 6,
      borderRadius: 3, backgroundColor: pal.band, zIndex: 3,
    },
    bandFront: { top: 6 },
    face: { position: 'absolute', left: 0, right: 0, top: 13 },
    eye: { position: 'absolute', width: 4.5, height: 6.5, borderRadius: 3, backgroundColor: '#22303B' },
    smile: {
      position: 'absolute', left: 12.5, top: 9, width: 9, height: 5,
      borderWidth: 1.8, borderColor: '#22303B', borderTopWidth: 0,
      borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
    },
    arm: { position: 'absolute', top: 4, width: 8, height: 20, borderRadius: 5, backgroundColor: pal.skin },
    sleeve: {
      position: 'absolute', left: -1, right: -1, top: -1, height: 10,
      borderRadius: 5, backgroundColor: pal.jersey,
    },
    fore: { position: 'absolute', left: 0, top: 16, width: 8, height: 18, borderRadius: 5, backgroundColor: pal.skin },
    racket: { position: 'absolute', left: 2, top: 13, width: 4, height: 20, borderRadius: 2, backgroundColor: '#B98A4C' },
    racketHead: {
      position: 'absolute', left: -9.5, top: -25, width: 23, height: 27,
      borderRadius: 13, borderWidth: 3, borderColor: '#2E4B5E',
      backgroundColor: 'rgba(255,255,255,0.5)',
    },
    stringH: { position: 'absolute', left: 1, right: 1, top: 9, height: 1.4, backgroundColor: 'rgba(150,180,200,0.95)' },
    stringV: { position: 'absolute', top: 1, bottom: 1, left: 8, width: 1.4, backgroundColor: 'rgba(150,180,200,0.95)' },
    // 상단+우측 보더만 칠한 원 → 회전하면 호가 궤적을 쓸고 간다
    swoosh: {
      position: 'absolute',
      borderWidth: 4.5,
      borderTopColor: 'rgba(255,255,255,0.95)',
      borderRightColor: 'rgba(255,255,255,0.7)',
      borderBottomColor: 'transparent',
      borderLeftColor: 'transparent',
    },
  });
}
