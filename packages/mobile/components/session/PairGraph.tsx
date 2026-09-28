import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Text as SvgText, G } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';

// ─────────────────────────────────────────────────────────────
// 중복 점검 시각화 — 4명(또는 2~3명)을 원형으로 배치하고, 모든 짝 사이에
// 선을 긋는다. 함께 친 횟수에 따라 선 색·굵기, 중앙에 횟수. (우동배 스타일)
// ─────────────────────────────────────────────────────────────

export interface PairPlayer {
  id: string;
  name: string;
}

export function PairGraph({
  players,
  pairCount,
  size = 260,
}: {
  players: PairPlayer[];
  pairCount: (aId: string, bId: string) => number;
  size?: number;
}) {
  const { colors } = useTheme();
  const n = players.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 46; // 노드 반지름 여백

  // 원형 배치(맨 위부터 시계방향). 노드 좌표.
  const pos = players.map((_, i) => {
    const ang = (-90 + (i * 360) / n) * (Math.PI / 180);
    return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  const colorFor = (c: number) => (c >= 2 ? colors.danger : c === 1 ? colors.warning : colors.border);
  const widthFor = (c: number) => (c >= 2 ? 4 : c === 1 ? 2.5 : 1.2);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {/* 선(짝) 먼저 — 노드 아래로 */}
        {pos.map((p, i) =>
          pos.slice(i + 1).map((q, jj) => {
            const j = i + 1 + jj;
            const c = pairCount(players[i].id, players[j].id);
            const mx = (p.x + q.x) / 2;
            const my = (p.y + q.y) / 2;
            return (
              <G key={`${i}-${j}`}>
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
          }),
        )}
        {/* 노드 */}
        {pos.map((p, i) => (
          <G key={i}>
            <Circle cx={p.x} cy={p.y} r={20} fill={colors.primary} />
            <SvgText x={p.x} y={p.y + 5} fontSize={14} fontWeight="800" fill="#fff" textAnchor="middle">
              {players[i].name.slice(0, 1)}
            </SvgText>
          </G>
        ))}
      </Svg>
      {/* 이름 범례(초성만으론 헷갈리니 이름 칩) */}
      <View style={styles.names}>
        {players.map((p) => (
          <View key={p.id} style={[styles.nameChip, { backgroundColor: colors.primaryBg }]}>
            <Text style={[styles.nameInitial, { color: colors.primary }]}>{p.name.slice(0, 1)}</Text>
            <Text style={[styles.nameText, { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  names: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 8 },
  nameChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  nameInitial: { fontSize: 11, fontWeight: '900' },
  nameText: { fontSize: 12.5, fontWeight: '700', maxWidth: 90 },
});
