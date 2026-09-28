import { View, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Text as SvgText, G } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';

// ─────────────────────────────────────────────────────────────
// 중복 점검 시각화 — 4명(또는 2~3명)을 원형으로 배치하고, 모든 짝 사이에
// 선을 긋는다. 함께 친 횟수에 따라 선 색·굵기, 선 위에 횟수. 노드엔 전체 이름.
// (겹치는 대각선 숫자는 선에 수직으로 살짝 밀어 분리.)
// ─────────────────────────────────────────────────────────────

export interface PairPlayer {
  id: string;
  name: string;
}

export function PairGraph({
  players,
  pairCount,
  size = 300,
}: {
  players: PairPlayer[];
  pairCount: (aId: string, bId: string) => number;
  size?: number;
}) {
  const { colors } = useTheme();
  const n = players.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 58; // 노드 원 + 이름 라벨 여백

  // 원형 배치(맨 위부터 시계방향).
  const pos = players.map((_, i) => {
    const ang = (-90 + (i * 360) / n) * (Math.PI / 180);
    return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  const colorFor = (c: number) => (c >= 2 ? colors.danger : c === 1 ? colors.warning : colors.border);
  const widthFor = (c: number) => (c >= 2 ? 4 : c === 1 ? 2.5 : 1.4);

  // 짝(엣지) 목록 — 라벨 겹침 방지를 위해 인덱스로 수직 오프셋 부호를 번갈아.
  const edges: { i: number; j: number; k: number }[] = [];
  let ek = 0;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) edges.push({ i, j, k: ek++ });

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {/* 선(짝) — 노드 아래 */}
        {edges.map(({ i, j, k }) => {
          const p = pos[i];
          const q = pos[j];
          const c = pairCount(players[i].id, players[j].id);
          // 라벨 위치: 선 중점에서 수직으로 살짝(겹치는 대각선 분리).
          let mx = (p.x + q.x) / 2;
          let my = (p.y + q.y) / 2;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = (k % 2 === 0 ? 1 : -1) * 13;
          mx += (-dy / len) * off;
          my += (dx / len) * off;
          return (
            <G key={`e${i}-${j}`}>
              <Line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={colorFor(c)} strokeWidth={widthFor(c)} strokeLinecap="round" />
              {c > 0 && (
                <>
                  <Circle cx={mx} cy={my} r={12} fill={colors.surface} stroke={colorFor(c)} strokeWidth={1.5} />
                  <SvgText x={mx} y={my + 4} fontSize={12} fontWeight="800" fill={colorFor(c)} textAnchor="middle">
                    {c}
                  </SvgText>
                </>
              )}
            </G>
          );
        })}
        {/* 노드 + 전체 이름(원 아래) */}
        {pos.map((p, i) => {
          const belowCenter = p.y > cy + 4;
          const labelY = belowCenter ? p.y + 38 : p.y - 28;
          return (
            <G key={`n${i}`}>
              <Circle cx={p.x} cy={p.y} r={19} fill={colors.primary} />
              <SvgText x={p.x} y={p.y + 5} fontSize={14} fontWeight="800" fill="#fff" textAnchor="middle">
                {players[i].name.slice(0, 1)}
              </SvgText>
              <SvgText x={p.x} y={labelY} fontSize={13} fontWeight="700" fill={colors.text} textAnchor="middle">
                {players[i].name.length > 5 ? players[i].name.slice(0, 5) : players[i].name}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({});
