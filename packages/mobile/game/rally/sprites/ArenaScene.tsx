/**
 * 콕고 랠리 — 브라이트 아레나 씬 (react-native-svg).
 * Kenney 캐릭터의 밝은 데이라이트 톤에 맞춘 캐주얼 스포츠 게임 룩:
 * 밝은 블루 체육관 벽 + 쨍한 그린 코트 + 컬러풀 관중.
 * court3d의 핀홀 투영을 그대로 써서 SVG polygon으로 그린다 —
 * 직선은 투영 후에도 직선이므로 계단 현상이 없다.
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

  // 관중 도트 — 밝고 컬러풀하게 (결정적 배치)
  const crowd: { x: number; y: number; c: string; r: number }[] = [];
  const crowdColors = ['#F4A261', '#E76F51', '#2A9D8F', '#E9C46A', '#8AB17D', '#F8F9FA', '#B5838D'];
  for (let i = 0; i < 42; i++) {
    const fx = ((i * 37) % 100) / 100;
    crowd.push({
      x: adL + (adR - adL) * fx,
      y: adTop - 12 - (i % 2) * 10 - ((i * 13) % 5),
      c: crowdColors[i % crowdColors.length],
      r: 2.6 + ((i * 7) % 3) * 0.7,
    });
  }

  const lineProps = { stroke: '#FFFFFF', strokeWidth: 2.4, opacity: 1 } as const;

  return (
    <Svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9BDCF5" />
          <Stop offset="1" stopColor="#6FBEE4" />
        </LinearGradient>
        <RadialGradient id="courtSpot" cx="50%" cy="62%" r="72%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.14} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="matIn" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#48B372" />
          <Stop offset="1" stopColor="#55C57F" />
        </LinearGradient>
        <LinearGradient id="matOut" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#379159" />
          <Stop offset="1" stopColor="#3FA265" />
        </LinearGradient>
        <LinearGradient id="nearFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#EAF4FB" stopOpacity={0} />
          <Stop offset="1" stopColor="#EAF4FB" stopOpacity={1} />
        </LinearGradient>
      </Defs>

      {/* 벽·바닥 — 밝은 실내 체육관 */}
      <Rect x={0} y={0} width={W} height={adTop} fill="url(#wallGrad)" />
      <Rect x={0} y={adTop} width={W} height={H - adTop} fill="#4FA3D8" />

      {/* 관중석 */}
      <Rect x={adL - 12} y={adTop - 30} width={adR - adL + 24} height={30} rx={5} fill="#3E85B8" />
      {crowd.map((d, i) => (
        <Ellipse key={i} cx={d.x} cy={d.y} rx={d.r} ry={d.r} fill={d.c} />
      ))}

      {/* 콕고 광고판 */}
      <Rect x={adL} y={adTop} width={adR - adL} height={adBottom - adTop} fill="#12A88F" />
      <Rect x={adL} y={adTop} width={adR - adL} height={2.5} fill="#0E8674" />
      <SvgText x={adL + (adR - adL) * 0.2} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="#FFFFFF" textAnchor="middle" letterSpacing="2">콕고</SvgText>
      <SvgText x={adL + (adR - adL) * 0.5} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="#FFFFFF" textAnchor="middle" letterSpacing="2">KOKGO</SvgText>
      <SvgText x={adL + (adR - adL) * 0.8} y={adBottom - (adBottom - adTop) * 0.3} fontSize={11} fontFamily={juaFont} fontWeight="bold" fill="#FFFFFF" textAnchor="middle" letterSpacing="2">콕고</SvgText>

      {/* 매트 (바깥 → 안) */}
      <Polygon points={poly(proj, [[-MAT_X, MAT_Y], [MAT_X, MAT_Y], [MAT_X, -MAT_Y], [-MAT_X, -MAT_Y]])} fill="url(#matOut)" />
      <Polygon points={poly(proj, [[-COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, -COURT.HALF_LEN], [-COURT.HALF_W, -COURT.HALF_LEN]])} fill="url(#matIn)" />

      {/* 은은한 센터 스포트 */}
      <Rect x={0} y={0} width={W} height={H} fill="url(#courtSpot)" />

      {/* 라인 — 복식 외곽, 단식 사이드, 센터(서비스라인→베이스라인), 숏서비스 */}
      <Polygon points={poly(proj, [[-COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, COURT.HALF_LEN], [COURT.HALF_W, -COURT.HALF_LEN], [-COURT.HALF_W, -COURT.HALF_LEN]])} fill="none" {...lineProps} />
      <Line x1={proj.x(-COURT.SINGLES_W, -COURT.HALF_LEN)} y1={proj.y(-COURT.HALF_LEN, 0)} x2={proj.x(-COURT.SINGLES_W, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} />
      <Line x1={proj.x(COURT.SINGLES_W, -COURT.HALF_LEN)} y1={proj.y(-COURT.HALF_LEN, 0)} x2={proj.x(COURT.SINGLES_W, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} />
      <Line x1={proj.x(-COURT.HALF_W, COURT.SHORT_SERVICE)} y1={proj.y(COURT.SHORT_SERVICE, 0)} x2={proj.x(COURT.HALF_W, COURT.SHORT_SERVICE)} y2={proj.y(COURT.SHORT_SERVICE, 0)} {...lineProps} />
      <Line x1={proj.x(-COURT.HALF_W, -COURT.SHORT_SERVICE)} y1={proj.y(-COURT.SHORT_SERVICE, 0)} x2={proj.x(COURT.HALF_W, -COURT.SHORT_SERVICE)} y2={proj.y(-COURT.SHORT_SERVICE, 0)} {...lineProps} />
      <Line x1={proj.x(0, COURT.SHORT_SERVICE)} y1={proj.y(COURT.SHORT_SERVICE, 0)} x2={proj.x(0, COURT.HALF_LEN)} y2={proj.y(COURT.HALF_LEN, 0)} {...lineProps} opacity={0.7} />
      <Line x1={proj.x(0, -COURT.SHORT_SERVICE)} y1={proj.y(-COURT.SHORT_SERVICE, 0)} x2={proj.x(0, -COURT.HALF_LEN)} y2={proj.y(-COURT.HALF_LEN, 0)} {...lineProps} opacity={0.7} />

      {/* 근경 페이드 */}
      <Rect x={0} y={nearY + 6} width={W} height={Math.max(0, H - nearY - 6)} fill="url(#nearFade)" />
    </Svg>
  );
});

/**
 * 네트 — 별도 레이어. 원경(상대·먼 쪽 셔틀) 위, 근경(내 쪽 셔틀·내 캐릭터) 아래에
 * 끼워 넣어 진짜 깊이를 만든다. 배경에 붙어 있으면 상대가 네트 '앞'에 서고
 * 셔틀이 네트를 무시하고 그려져서 게임 같지 않아진다.
 */
export const CourtNet = memo(function CourtNet({ proj }: { proj: Projector }) {
  const netTop = proj.y(0, COURT.NET_H);
  const netBottom = proj.y(0, 0);
  const netL = proj.x(-COURT.HALF_W - 0.4, 0);
  const netR = proj.x(COURT.HALF_W + 0.4, 0);
  const meshLines = [];
  for (let x = netL + 10; x < netR - 4; x += 13) meshLines.push(x);
  return (
    <Svg width={proj.w} height={proj.h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
      <Rect x={netL} y={netTop} width={netR - netL} height={netBottom - netTop} fill="rgba(38,70,102,0.18)" />
      <G opacity={0.42} stroke="#FFFFFF" strokeWidth={0.8}>
        {meshLines.map((x) => (
          <Line key={x} x1={x} y1={netTop + 5} x2={x} y2={netBottom} />
        ))}
        <Line x1={netL} y1={(netTop + netBottom) / 2} x2={netR} y2={(netTop + netBottom) / 2} />
        <Line x1={netL} y1={netTop + (netBottom - netTop) * 0.75} x2={netR} y2={netTop + (netBottom - netTop) * 0.75} />
      </G>
      <Rect x={netL} y={netTop} width={netR - netL} height={4.5} fill="#FFFFFF" />
      <Rect x={netL} y={netTop + 4.5} width={netR - netL} height={1.4} fill="#C3D6E4" />
      <Rect x={netL - 3} y={netTop - 4} width={5} height={netBottom - netTop + 8} rx={2.5} fill="#5A7186" />
      <Rect x={netR - 2} y={netTop - 4} width={5} height={netBottom - netTop + 8} rx={2.5} fill="#5A7186" />
    </Svg>
  );
});
