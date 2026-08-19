/**
 * 콕고 랠리 — Kenney Toon Characters 기반 캐릭터 (CC0, kenney.nl).
 * 실제 게임 에셋 스프라이트: 플레이어=Female person(뒷모습·러닝·스윙),
 * AI=Male person. 포즈 전환과 러닝 프레임은 리렌더 없이 공유값 opacity로
 * 스위칭한다(60fps 루프에서 setState 금지). 라켓은 스윙 때 SVG 오버레이.
 *
 * poseMode: 0=기본(뒷/앞모습) 1=러닝 2=스윙 3=런지
 */
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Ellipse, G, Line } from 'react-native-svg';

const SPRITES = {
  male: {
    base: require('../../../assets/game/char/player_back.png'),
    run: [
      require('../../../assets/game/char/player_run0.png'),
      require('../../../assets/game/char/player_run1.png'),
      require('../../../assets/game/char/player_run2.png'),
    ],
    attack: require('../../../assets/game/char/player_attack.png'),
    lunge: require('../../../assets/game/char/player_lunge.png'),
    cheer: require('../../../assets/game/char/player_cheer.png'),
  },
  female: {
    base: require('../../../assets/game/char/playerf_back.png'),
    run: [
      require('../../../assets/game/char/playerf_run0.png'),
      require('../../../assets/game/char/playerf_run1.png'),
      require('../../../assets/game/char/playerf_run2.png'),
    ],
    attack: require('../../../assets/game/char/playerf_attack.png'),
    lunge: require('../../../assets/game/char/playerf_lunge.png'),
    cheer: require('../../../assets/game/char/playerf_cheer.png'),
  },
  ai: {
    base: require('../../../assets/game/char/ai_idle.png'),
    run: [
      require('../../../assets/game/char/ai_run0.png'),
      require('../../../assets/game/char/ai_run1.png'),
      require('../../../assets/game/char/ai_run2.png'),
    ],
    attack: require('../../../assets/game/char/ai_attack.png'),
    lunge: require('../../../assets/game/char/ai_lunge.png'),
    cheer: require('../../../assets/game/char/ai_cheer.png'),
  },
} as const;

function RacketSvg() {
  return (
    <Svg width={46} height={46} viewBox="0 0 46 46">
      <Line x1={6} y1={40} x2={20} y2={26} stroke="#3D4A5C" strokeWidth={3.4} strokeLinecap="round" />
      <G transform="rotate(45 28 18)">
        <Ellipse cx={28} cy={18} rx={8.6} ry={12} fill="rgba(248,250,252,0.45)" stroke="#3D4A5C" strokeWidth={2.6} />
        <G stroke="#94A3B8" strokeWidth={0.7} opacity={0.75}>
          <Line x1={24.5} y1={8.5} x2={24.5} y2={27.5} />
          <Line x1={28} y1={6.8} x2={28} y2={29.2} />
          <Line x1={31.5} y1={8.5} x2={31.5} y2={27.5} />
          <Line x1={20.5} y1={13} x2={35.5} y2={13} />
          <Line x1={19.6} y1={18} x2={36.4} y2={18} />
          <Line x1={20.5} y1={23} x2={35.5} y2={23} />
        </G>
      </G>
    </Svg>
  );
}

export type SpriteKey = keyof typeof SPRITES;

export interface KenneyCharacterProps {
  variant: SpriteKey;
  poseMode: SharedValue<number>;
  runFrame: SharedValue<number>;
  armStyle: object; // 라켓 스윙 회전(부모 공유값)
}

export function KenneyCharacter({ variant, poseMode, runFrame, armStyle }: KenneyCharacterProps) {
  const s = SPRITES[variant];
  const baseOp = useAnimatedStyle(() => ({ opacity: poseMode.value === 0 ? 1 : 0 }));
  const run0Op = useAnimatedStyle(() => ({ opacity: poseMode.value === 1 && Math.floor(runFrame.value) % 3 === 0 ? 1 : 0 }));
  const run1Op = useAnimatedStyle(() => ({ opacity: poseMode.value === 1 && Math.floor(runFrame.value) % 3 === 1 ? 1 : 0 }));
  const run2Op = useAnimatedStyle(() => ({ opacity: poseMode.value === 1 && Math.floor(runFrame.value) % 3 === 2 ? 1 : 0 }));
  const attackOp = useAnimatedStyle(() => ({ opacity: poseMode.value === 2 ? 1 : 0 }));
  const lungeOp = useAnimatedStyle(() => ({ opacity: poseMode.value === 3 ? 1 : 0 }));
  const cheerOp = useAnimatedStyle(() => ({ opacity: poseMode.value === 4 ? 1 : 0 }));
  // 배드민턴 선수는 항상 라켓을 든다 — 세리머니 때만 내려놓는다
  const racketOp = useAnimatedStyle(() => ({ opacity: poseMode.value === 4 ? 0 : 1 }));

  return (
    <View style={st.box} pointerEvents="none">
      <View style={st.shadow} />
      <Animated.Image source={s.base} style={[st.img, baseOp]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.run[0]} style={[st.img, run0Op]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.run[1]} style={[st.img, run1Op]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.run[2]} style={[st.img, run2Op]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.attack} style={[st.img, attackOp]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.lunge} style={[st.img, lungeOp]} resizeMode="contain" fadeDuration={0} />
      <Animated.Image source={s.cheer} style={[st.img, cheerOp]} resizeMode="contain" fadeDuration={0} />
      <Animated.View style={[st.racket, racketOp, armStyle]}>
        <RacketSvg />
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  box: { width: 78, height: 104 },
  shadow: {
    position: 'absolute', bottom: 0, left: 17, width: 44, height: 9,
    borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.34)',
  },
  img: { position: 'absolute', width: 78, height: 104 },
  racket: { position: 'absolute', left: -8, top: 18, width: 46, height: 46, transformOrigin: '10px 40px' } as never,
});
