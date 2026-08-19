/**
 * 콕고 랠리 — 클럽 나이트 아레나 씬 (react-native-svg).
 * court3d의 핀홀 투영을 그대로 써서 SVG polygon으로 그린다 —
 * 직선은 투영 후에도 직선이므로 스트립 근사·계단 현상이 없다.
 * 정적 씬: (w,h) 변경 시에만 부모가 재마운트한다.
 */
import { memo } from 'react';
import Svg, {
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { COURT, Projector } from '../court3d';

const MAT_X = 4.35;
const MAT_Y = COURT.HALF_LEN + 1.15;

function poly(p: Projector, pts: [number, number][]): string {
  return pts.map(([wx, wy]) => `${p.x(wx, wy).toFixed(1)},${p.y(wy, 0).toFixed(1)}`).join(' ');
}

export const ArenaScene = memo(function ArenaScene({ proj, juaFont }: { proj: Projector; juaFont?: string }) {
  const W = proj.w;
  const H = proj.h;

  const adTop = proj.y(7.55, 1.0);
  const adBottom = proj.y(7.55, 0);
  const adL = proj.x(-4.6, 7.55);
  const adR = proj.x(4.6, 7.55);
  const nearY = proj.y(-COURT.HALF_LEN, 0);

  const netTop = proj.y(0, COURT.NET_H);
  const netBottom = proj.y(0, 0);
  const netL = proj.x(-COURT.HALF_W - 0.4, 0);
  const netR = proj.x(COURT.HALF_W + 0.4, 0);

  // 관중 도트 — 결정적 배치
  const crowd: { x: number; y: number; c: string; r: number }[] = [];
  const crowdColors = ['#6B7A8F', '#8A6F5C', '#5C748A', '#7F6B8A', '#5F8A75', '#8A5C5C'];
  for (let i = 0; i < 42; i++) {
    const fx = ((i * 37) % 100) / 100;
    crowd.push({
      x: adL + (adR - adL) * fx,
      y: adTop - 12 - (i % 2) * 10 - ((i * 13) % 5),
      c: crowdColors[i % crowdColors.length],
      r: 2.6 + ((i * 7) % 3) * 0.7,
    });
  }

  // 네트 메쉬 세로줄
  const meshLines = [];
  for (let x = netL + 10; x < netR - 4; x += 13) meshLines.push(x);

  const lineProps = { stroke: '#F8FAFC', strokeWidth: 2.2, opacity: 0.95 } as const;

  return (
    <Svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#5EEAD4" stopOpacity={0.1} />
          <Stop offset="1" stopColor="#5EEAD4" stopOpacity={0} />
        </LinearGradient>
        <RadialGradient id="floorGlow" cx="50%" cy="66%" r="70%">
          <Stop offset="0" stopColor="#2E8B67" stopOpacity={0.3} />
          <Stop offset="1" stopColor="#2E8B67" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="matIn" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#25705A" />
          <Stop offset="1" stopColor="#2E8B67" />
        </LinearGradient>
        <LinearGradient id="matOut" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#174C3B" />
          <Stop offset="1" stopColor="#1D5F47" />
        </LinearGradient>
        <LinearGradient id="nearFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#10151D" stopOpacity={0} />
          <Stop offset="1" stopColor="#10151D" stopOpacity={1} />
        </LinearGradient>
      </Defs>

      {/* 벽·바닥 */}
      <Rect x={0} y={0} width={W} height={adTop} fill="#141A24" />
      <Rect x={0} y={adTop} width={W} height={H - adTop} fill="#222B3A" />
      <Rect x={0} y={0} width={W} height={H} fill="url(#floorGlow)" />

      {/* 관중석 */}
      <Rect x={adL - 12} y={adTop - 30} width={adR - adL + 24} height={30} rx={5} fill="#1A222E" />
      {crowd.map((d, i) => (
        <Ellipse key={i} cx={d.x} cy={d.y} rx={d.r} ry={d.r} fill={d.c} />
      ))}

      {/* 콕고 광고판 */}
      <Rect x={adL} y={adTop} width={adR - adL} height={adBottom - adTop} fill="#0E7A63" />
      <Rect x={adL} y={adTop} width={adR - adL} height={2.5} fill="#134E40" />
      <SvgText x={adL + (adR - adL) * 0.2} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="rgba(255,255,255,0.85)" textAnchor="middle" letterSpacing="2">콕고</SvgText>
      <SvgText x={adL + (adR - adL) * 0.5} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="rgba(255,255,255,0.85)" textAnchor="middle" letterSpacing="2">KOKGO</SvgText>
      <SvgText x={adL + (adR - adL) * 0.8} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="rgba(255,255,255,0.85)" textAnchor="middle" letterSpacing="2">콕고</SvgText>

      {/* 조명 콘 */}
      <Polygon points={`${W / 2 - 44},0 ${W / 2 + 44},0 ${W * 0.94},${H} ${W * 0.06},${H}`} fill="url(#cone)" />

      {/* 매트 (바깥 → 안) */}
      <Polygon points={poly(proj, [[-MAT_X, MAT_Y], [MAT_X, MAT_Y], [MAT_X, -MAT_Y], [-MAT_X, -MAT_Y]])} fill="url(#matOut)" />
      <Polygon points={poly(proj, [[-COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, -COURT.HALF_LEN], [-COURT.HALF_W, -COURT.HALF_LEN]])} fill="url(#matIn)" />

      {/* 라인 — 복식 외곽, 단식 사이드, 센터(서비스라인→베이스라인), 숏서비스 */}
      <Polygon points={poly(proj, [[-COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, -COURT.HALF_LEN], [-COURT.HALF_W, -COURT.HALF_LEN]])} fill="none" {...lineProps} />
      <Line x1={proj.x(-COURT.SINGLES_W, -COURT.HALF_LEN)} y1={proj.y(-COURT.HALF_LEN, 0)} x2={proj.x(-COURT.SINGLES_W, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} />
      <Line x1={proj.x(COURT.SINGLES_W, -COURT.HALF_LEN)} y1={proj.y(-COURT.HALF_LEN, 0)} x2={proj.x(COURT.SINGLES_W, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} />
      <Line x1={proj.x(-COURT.HALF_W, COURT.SHORT_SERVICE)} y1={proj.y(COURT.SHORT_SERVICE, 0)} x2={proj.x(COURT.HALF_W, COURT.SHORT_SERVICE)} y2={proj.y(COURT.SHORT_SERVICE, 0)} {...lineProps} />
      <Line x1={proj.x(-COURT.HALF_W, -COURT.SHORT_SERVICE)} y1={proj.y(-COURT.SHORT_SERVICE, 0)} x2={proj.x(COURT.HALF_W, -COURT.SHORT_SERVICE)} y2={proj.y(-COURT.SHORT_SERVICE, 0)} {...lineProps} />
      <Line x1={proj.x(0, COURT.SHORT_SERVICE)} y1={proj.y(COURT.SHORT_SERVICE, 0)} x2={proj.x(0, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} opacity={0.6} />
      <Line x1={proj.x(0, -COURT.SHORT_SERVICE)} y1={proj.y(-COURT.SHORT_SERVICE, 0)} x2={proj.x(0, -COURT.HALF_LEN)} y2={proj.y(-COURT.HALF_LEN, 0)} {...lineProps} opacity={0.6} />

      {/* 네트 */}
      <Rect x={netL} y={netTop} width={netR - netL} height={netBottom - netTop} fill="rgba(16,21,29,0.34)" />
      <G opacity={0.28} stroke="#CBD5E1" strokeWidth={0.8}>
        {meshLines.map((x) => (
          <Line key={x} x1={x} y1={netTop + 5} x2={x} y2={netBottom} />
        ))}
        <Line x1={netL} y1={(netTop + netBottom) / 2} x2={netR} y2={(netTop + netBottom) / 2} />
        <Line x1={netL} y1={netTop + (netBottom - netTop) * 0.75} x2={netR} y2={netTop + (netBottom - netTop) * 0.75} />
      </G>
      <Rect x={netL} y={netTop} width={netR - netL} height={4.5} fill="#F8FAFC" />
      <Rect x={netL - 3} y={netTop - 4} width={5} height={netBottom - netTop + 8} rx={2.5} fill="#3D4A5C" />
      <Rect x={netR - 2} y={netTop - 4} width={5} height={netBottom - netTop + 8} rx={2.5} fill="#3D4A5C" />

      {/* 근경 페이드 */}
      <Rect x={0} y={nearY + 6} width={W} height={Math.max(0, H - nearY - 6)} fill="url(#nearFade)" />
    </Svg>
  );
});
