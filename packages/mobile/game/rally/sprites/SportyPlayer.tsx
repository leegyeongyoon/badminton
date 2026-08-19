/**
 * 콕고 랠리 — 스포티 캐릭터 스프라이트 (react-native-svg).
 * 아트 캔버스의 "캐릭터 B — 스포티" 방향: 3등신 · 사선 슬래시 유니폼 ·
 * 스파이키 헤어 + 헤드밴드 · 등번호 07.
 *
 * 구조: 그림은 전부 SVG, 움직이는 파츠(다리 2 + 라켓 팔)는 부모가 주는
 * 애니메이티드 스타일(View transform)로 회전한다 — reanimated 스타일 경로만
 * 쓰므로 웹·네이티브 모두 안정적.
 * 디자인 캔버스: 64×124, 발끝이 y=122 (부모는 x-32, y-122로 앵커).
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

const SKIN = '#FFD9B0';
const SKIN_SHADE = '#EFC094';
const HAIR = '#33261A';
const HAIR_DARK = '#241A10';
const NAVY = '#1E293B';

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - f));
  const g = Math.round(((n >> 8) & 255) * (1 - f));
  const b = Math.round((n & 255) * (1 - f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ─── 다리 (교차 스윙용 분리 파츠) ───────────────────────────────────
function LegSvg({ kit }: { kit: string }) {
  return (
    <Svg width={14} height={38} viewBox="0 0 14 38">
      <Path d="M3.5 0 H10.5 Q12 8 11 17 Q10.5 23 9.5 24 H4.5 Q3.5 23 3 17 Q2 8 3.5 0 Z" fill={SKIN} />
      <Path d="M9 0 H10.5 Q12 8 11 17 Q10.5 23 9.5 24 H8 Q9.5 14 9 0 Z" fill={SKIN_SHADE} opacity={0.7} />
      <Rect x={2.6} y={22} width={8.8} height={5} rx={1.5} fill="#F8FAFC" />
      <Path d="M2 28 Q2 26 4.5 26 H9.5 Q12.6 27 13 30.5 L13 33 Q13 35.2 10.5 35.2 H4 Q2 35.2 2 33 Z" fill="#F8FAFC" />
      <Path d="M2.4 30.5 L12.8 30.5" stroke={kit} strokeWidth={1.8} />
      <Rect x={2} y={34.4} width={11} height={2.6} rx={1.3} fill="#CBD5E1" />
    </Svg>
  );
}

// ─── 라켓 팔 (스윙 파츠) — 피벗은 (6,10) 어깨 ────────────────────────
function ArmSvg({ kit }: { kit: string }) {
  return (
    <Svg width={60} height={60} viewBox="0 0 60 60">
      <Path d="M6 10 Q18 10 27 18" stroke={SKIN} strokeWidth={8.5} strokeLinecap="round" fill="none" />
      <Circle cx={6.5} cy={10} r={6} fill={kit} />
      <Circle cx={28} cy={19} r={4} fill={SKIN} />
      <Line x1={28.5} y1={19.5} x2={34.5} y2={25.5} stroke="#1F2937" strokeWidth={4.5} strokeLinecap="round" />
      <Line x1={34} y1={25} x2={41.5} y2={32.5} stroke="#3D4A5C" strokeWidth={2.6} strokeLinecap="round" />
      <G transform="rotate(45 47 39)">
        <Ellipse cx={47} cy={39} rx={8.2} ry={11.4} fill="rgba(248,250,252,0.4)" stroke="#3D4A5C" strokeWidth={2.4} />
        <G stroke="#94A3B8" strokeWidth={0.7} opacity={0.75}>
          <Line x1={43.5} y1={30} x2={43.5} y2={48} />
          <Line x1={47} y1={28.6} x2={47} y2={49.4} />
          <Line x1={50.5} y1={30} x2={50.5} y2={48} />
          <Line x1={40} y1={35} x2={54} y2={35} />
          <Line x1={39.4} y1={39} x2={54.6} y2={39} />
          <Line x1={40} y1={43} x2={54} y2={43} />
        </G>
      </G>
    </Svg>
  );
}

// ─── 몸통·머리 (정적 레이어) ────────────────────────────────────────
function BodySvg({ kit, variant, juaFont }: { kit: string; variant: 'back' | 'front'; juaFont?: string }) {
  const dark = darken(kit, 0.24);
  const back = variant === 'back';
  return (
    <Svg width={64} height={124} viewBox="0 0 64 124" style={StyleSheet.absoluteFill}>
      {/* 왼팔 (몸 뒤) */}
      <Path d="M20 45 Q11 53 13.5 65" stroke={SKIN} strokeWidth={8} strokeLinecap="round" fill="none" />
      <Circle cx={21} cy={44} r={5.5} fill={kit} />

      {/* 목 */}
      <Rect x={28} y={32} width={8} height={8} rx={3} fill={SKIN} />

      {/* 몸통 */}
      <Path d="M18 44 Q18 38 24 38 H40 Q46 38 46 44 L47 66 Q47 74 40 74 H24 Q17 74 17 66 Z" fill={kit} />
      <Path d="M39 38 H40 Q46 38 46 44 L47 66 Q47 74 40 74 H37 Q39 56 39 38 Z" fill={dark} opacity={0.55} />
      {back ? (
        <Polygon points="17.5,56 46.5,46 46.5,52 17.5,62" fill="rgba(255,255,255,0.85)" />
      ) : (
        <Polygon points="17.5,46 46.5,56 46.5,62 17.5,52" fill="rgba(255,255,255,0.85)" />
      )}
      <Path d="M18 44 Q18 38 24 38 H40 Q46 38 46 44 L47 66 Q47 74 40 74 H24 Q17 74 17 66 Z" fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth={1} />

      {back ? (
        <>
          <SvgText x={32} y={50} fontSize={6.2} fontFamily={juaFont} fontWeight="bold" fill="rgba(255,255,255,0.8)" textAnchor="middle" letterSpacing="1.5">KOKGO</SvgText>
          <SvgText x={32} y={70} fontSize={16} fontFamily={juaFont} fontWeight="bold" fill="#F8FAFC" textAnchor="middle">07</SvgText>
        </>
      ) : (
        <>
          <Circle cx={25} cy={64} r={4.6} fill="#F8FAFC" />
          <Circle cx={25} cy={66} r={1.4} fill="#E11D48" />
          <Path d="M25 64.6 L22 59 L25 60.6 L28 59 Z" fill="#94A3B8" />
        </>
      )}

      {/* 반바지 */}
      <Path d="M19 72 H45 L47 87 Q47 90.5 43.5 90.5 H35.5 L33.5 81 H30.5 L28.5 90.5 H20.5 Q17 90.5 17 87 Z" fill={NAVY} />
      <Rect x={18} y={71} width={28} height={3.2} rx={1.6} fill="#141C29" />
      <Path d="M19.5 74 L21 89" stroke={kit} strokeWidth={1.6} opacity={0.9} />
      <Path d="M44.5 74 L43 89" stroke={kit} strokeWidth={1.6} opacity={0.9} />

      {/* 머리 */}
      <Circle cx={32} cy={20} r={15.5} fill={back ? HAIR : SKIN} />
      {back ? (
        <>
          <Path d="M17 22 Q16 5 32 4.5 Q48 5 47 22 L47 28 Q46 31 43.5 32.5 Q46 22 39 17 H25 Q18 22 20.5 32.5 Q18 31 17 28 Z" fill={HAIR_DARK} />
          <Path d="M22 8 L26.5 1 L29.5 7.5 Z" fill={HAIR} />
          <Path d="M29.5 6.5 L33 0 L36 6.5 Z" fill={HAIR_DARK} />
          <Path d="M35.5 7.5 L39.5 1.5 L42.5 8.5 Z" fill={HAIR} />
        </>
      ) : (
        <>
          <Path d="M16.5 20 Q16 5 32 4.5 Q48 5 47.5 20 L47.5 16 Q42 9 36 10.5 L38.5 4.5 L33.5 9.5 L31 3.5 L28.5 9.5 L23 5 L25.5 10.5 Q19.5 11.5 16.5 17 Z" fill={HAIR} />
          <Circle cx={26} cy={22} r={2.5} fill="#1F2937" />
          <Circle cx={38} cy={22} r={2.5} fill="#1F2937" />
          <Circle cx={26.9} cy={21.1} r={0.9} fill="#F8FAFC" />
          <Circle cx={38.9} cy={21.1} r={0.9} fill="#F8FAFC" />
          <Path d="M23 17.5 L29 16.5" stroke={HAIR_DARK} strokeWidth={1.6} strokeLinecap="round" />
          <Path d="M41 17.5 L35 16.5" stroke={HAIR_DARK} strokeWidth={1.6} strokeLinecap="round" />
          <Path d="M28.5 28.5 Q32 31 35.5 28.5" stroke="#A16452" strokeWidth={2} strokeLinecap="round" fill="none" />
          <Circle cx={21} cy={25.5} r={2.8} fill="#FFA98F" opacity={0.5} />
          <Circle cx={43} cy={25.5} r={2.8} fill="#FFA98F" opacity={0.5} />
        </>
      )}
      {/* 헤드밴드 */}
      <Rect x={16.5} y={back ? 28 : 9.5} width={31} height={5} rx={2.5} fill="#F8FAFC" />
      <Circle cx={32} cy={back ? 30.5 : 12} r={1.8} fill={kit} />
    </Svg>
  );
}

// ─── 조립 ──────────────────────────────────────────────────────────
export interface SportyPlayerProps {
  kit: string;
  variant: 'back' | 'front';
  juaFont?: string;
  armStyle: object;
  legLStyle: object;
  legRStyle: object;
}

export const SportyPlayer = memo(function SportyPlayer({ kit, variant, juaFont, armStyle, legLStyle, legRStyle }: SportyPlayerProps) {
  return (
    <View style={st.box} pointerEvents="none">
      <View style={st.shadow} />
      <Animated.View style={[st.legL, legLStyle]}>
        <LegSvg kit={kit} />
      </Animated.View>
      <Animated.View style={[st.legR, legRStyle]}>
        <LegSvg kit={kit} />
      </Animated.View>
      <BodySvg kit={kit} variant={variant} juaFont={juaFont} />
      <Animated.View style={[st.arm, armStyle]}>
        <ArmSvg kit={kit} />
      </Animated.View>
    </View>
  );
});

const st = StyleSheet.create({
  box: { width: 64, height: 124 },
  shadow: {
    position: 'absolute', bottom: 0, left: 10, width: 44, height: 9,
    borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.34)',
  },
  legL: { position: 'absolute', left: 17, top: 85, width: 14, height: 38, transformOrigin: '7px 3px' } as never,
  legR: { position: 'absolute', left: 33, top: 85, width: 14, height: 38, transformOrigin: '7px 3px' } as never,
  arm: { position: 'absolute', left: 38, top: 34, width: 60, height: 60, transformOrigin: '6px 10px' } as never,
});
