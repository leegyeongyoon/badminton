import { useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Animated, PanResponder, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { PairGraph, type PairPlayer } from './PairGraph';
import type { SessionGameLogRow } from '../../services/clubSession';

// ─────────────────────────────────────────────────────────────
// 중복 점검 플로팅 패널 — 운영판에서 "열어둔 채 게임 짜기" 용.
// 전체 화면을 덮지 않고(배경 터치 통과), 헤더를 끌어 옮길 수 있다.
// ─────────────────────────────────────────────────────────────

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${String(m).padStart(2, '0')}`;
}

export function FloatingMatchupPanel({
  players,
  rows,
  title,
  onClose,
}: {
  players: PairPlayer[];
  rows: SessionGameLogRow[];
  title?: string;
  onClose: () => void;
}) {
  const { colors, shadows } = useTheme();
  const { width } = useWindowDimensions();
  const PANEL_W = Math.min(320, width - 24);

  // 시작 위치: 우상단 근처(게임판 왼쪽을 덜 가리게).
  const pan = useRef(new Animated.ValueXY({ x: Math.max(12, width - PANEL_W - 12), y: 90 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  const pairs = useMemo(() => {
    const out: { a: PairPlayer; b: PairPlayer; times: string[] }[] = [];
    for (let i = 0; i < players.length; i += 1)
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        const times = rows
          .filter((g) => g.players.some((p) => p.userId === a.id) && g.players.some((p) => p.userId === b.id))
          .map((g) => g.startedAt)
          .sort((x, y) => (x < y ? 1 : -1));
        out.push({ a, b, times });
      }
    return out.sort((x, y) => y.times.length - x.times.length);
  }, [players, rows]);

  const countFor = (aId: string, bId: string) =>
    pairs.find((p) => (p.a.id === aId && p.b.id === bId) || (p.a.id === bId && p.b.id === aId))?.times.length || 0;

  return (
    // absoluteFill + box-none → 패널 밖 터치는 뒤(게임판)로 통과.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.panel,
          shadows.lg,
          { width: PANEL_W, backgroundColor: colors.surface, borderColor: colors.primary, transform: pan.getTranslateTransform() },
        ]}
      >
        {/* 드래그 핸들(헤더) */}
        <View style={[styles.header, { borderBottomColor: colors.border }]} {...panResponder.panHandlers}>
          <Ionicons name="move" size={15} color={colors.textLight} />
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>🔁 {title ?? '중복 점검'}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={18} color={colors.textLight} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ alignItems: 'center', paddingBottom: spacing.sm }}>
          <PairGraph players={players} pairCount={countFor} size={Math.min(240, PANEL_W - 30)} />
          <View style={{ alignSelf: 'stretch', gap: 5, marginTop: spacing.sm, paddingHorizontal: spacing.md }}>
            {pairs.map((pr, i) => {
              const c = pr.times.length;
              const col = c >= 2 ? colors.danger : c === 1 ? colors.warning : colors.textLight;
              return (
                <View key={i} style={[styles.row, { borderColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.pair, { color: colors.text }]} numberOfLines={1}>
                      {pr.a.name} <Text style={{ color: colors.textLight }}>↔</Text> {pr.b.name}
                    </Text>
                    {c > 0 && (
                      <Text style={[styles.times, { color: colors.textSecondary }]} numberOfLines={1}>
                        {pr.times.map(hhmm).join(', ')}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.pill, { backgroundColor: col + '1F' }]}>
                    <Text style={[styles.pillText, { color: col }]}>{c === 0 ? '처음' : `${c}회`}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: colors.textLight }]}>헤더를 끌어 옮기세요 · 뒤에서 바로 게임 편성 가능</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', borderRadius: radius.lg, borderWidth: 1.5, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1 },
  title: { flex: 1, fontSize: 14, fontWeight: '800' },
  closeBtn: { padding: 2 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, gap: spacing.sm },
  pair: { fontSize: 13, fontWeight: '700' },
  times: { fontSize: 11, marginTop: 1 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: '800' },
  hint: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md },
});
