import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { PairGraph, type PairPlayer } from './PairGraph';
import type { SessionGameLogRow } from '../../services/clubSession';

// ─────────────────────────────────────────────────────────────
// 중복 점검 상세 — 선 그래프(누가 누구랑) + 각 짝이 "몇 시에" 함께 쳤는지 목록.
// rows(정모 게임 기록)에서 시각까지 뽑아 "언제 어떻게"를 다 보여준다.
// ─────────────────────────────────────────────────────────────

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${String(m).padStart(2, '0')}`;
}

export function PairDetailModal({
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
  const { colors } = useTheme();

  // 각 짝별: 함께 친 게임들의 시각(내림차순).
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
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>🔁 {title ?? '중복 점검'}</Text>
          <Text style={[styles.sub, { color: colors.textLight }]}>선 = 함께 친 횟수 · 아래는 몇 시에 쳤는지</Text>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ alignItems: 'center' }}>
            <PairGraph players={players} pairCount={countFor} size={300} />

            <View style={{ alignSelf: 'stretch', gap: 6, marginTop: spacing.md }}>
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
                        <Text style={[styles.times, { color: colors.textSecondary }]} numberOfLines={2}>
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
          </ScrollView>

          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: colors.primary }]}>
            <Text style={styles.closeText}>닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 420, borderRadius: radius.lg, padding: spacing.lg },
  title: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  sub: { ...typography.caption, textAlign: 'center', marginTop: 2, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, gap: spacing.sm },
  pair: { fontSize: 14, fontWeight: '700' },
  times: { fontSize: 11.5, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontSize: 12.5, fontWeight: '800' },
  close: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center', marginTop: spacing.md },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
