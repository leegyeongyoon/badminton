/**
 * 콕고 랠리 — 셔틀콕·이펙트 벡터 (react-native-svg).
 * 위치·회전은 부모의 Animated.View transform이 담당하고, 여기는 그림만 그린다.
 */
import Svg, { Circle, Ellipse, Path, G } from 'react-native-svg';

// 코르크가 아래(진행 방향), 깃털이 위로 뻗는 기본 자세.
// 부모가 진행 방향에 맞춰 회전시킨다.
export function ShuttleSvg({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.3} viewBox="0 0 26 34">
      {/* 깃털 3장 */}
      <Path d="M13 20 L4 3 Q8 6 10 4 L13 16 Z" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth={0.8} />
      <Path d="M13 20 L13 1 Q15 4 17 3 L15 17 Z" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={0.8} />
      <Path d="M13 20 L22 3 Q18 6 16 4 L13 16 Z" fill="#E8EDF3" stroke="#CBD5E1" strokeWidth={0.8} />
      {/* 밴드 + 코르크 */}
      <Ellipse cx={13} cy={21.5} rx={5.2} ry={3.2} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={0.8} />
      <Ellipse cx={13} cy={26.5} rx={4.6} ry={5} fill="#E11D48" />
      <Ellipse cx={11.4} cy={25} rx={1.6} ry={2} fill="#F87171" opacity={0.7} />
    </Svg>
  );
}

// 히트 순간 스파크 버스트 — 부모가 scale/opacity 애니메이션을 건다.
export function HitBurstSvg({ size = 60, color = '#FACC15' }: { size?: number; color?: string }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <G origin="30,30">
        {rays.map((r) => (
          <Path
            key={r}
            d="M30 6 L33 16 L30 13 L27 16 Z"
            fill={color}
            transform={`rotate(${r} 30 30)`}
          />
        ))}
        <Circle cx={30} cy={30} r={7} fill="none" stroke={color} strokeWidth={2.5} opacity={0.9} />
      </G>
    </Svg>
  );
}
