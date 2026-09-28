import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useAuthStore } from '../../store/authStore';
import { typography, spacing, radius } from '../../constants/theme';
import { clubSessionApi, type SessionGameLogRow } from '../../services/clubSession';
import { GameLog } from './GameLog';

// ─────────────────────────────────────────────────────────────
// 현황판 "내 오늘 기록" 칸 — 열지 않아도 바로: 오늘 내가 몇 판, 누구랑 몇 번 쳤는지.
// 탭하면 전체 게임 기록(내 게임)으로. 체크인한 본인용.
// ─────────────────────────────────────────────────────────────

export function MyGamesSummary({ clubSessionId }: { clubSessionId: string }) {
  const { colors, shadows } = useTheme();
  const { user } = useAuthStore();
  const myId = user?.id;
  const [rows, setRows] = useState<SessionGameLogRow[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await clubSessionApi.gameLog(clubSessionId));
    } catch {
      setRows([]);
    }
  }, [clubSessionId]);
  useEffect(() => { load(); }, [load]);

  const { myGames, partners } = useMemo(() => {
    const mine = (rows ?? []).filter((g) => myId && g.players.some((p) => p.userId === myId));
    const cnt = new Map<string, { name: string; n: number }>();
    for (const g of mine)
      for (const p of g.players)
        if (p.userId !== myId) {
          const e = cnt.get(p.userId) ?? { name: p.name, n: 0 };
          e.n += 1;
          cnt.set(p.userId, e);
        }
    const list = [...cnt.values()].sort((a, b) => b.n - a.n);
    return { myGames: mine.length, partners: list };
  }, [rows, myId]);

  if (!myId || rows === null) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.card, shadows.sm, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.92 }]}
      >
        <View style={styles.head}>
          <Text style={{ fontSize: 15 }}>🏸</Text>
          <Text style={[styles.title, { color: colors.text }]}>오늘 내 기록</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.count, { color: colors.primary }]}>{myGames}판</Text>
        </View>
        {myGames === 0 ? (
          <Text style={[styles.empty, { color: colors.textLight }]}>아직 친 게임이 없어요 — 게임을 하면 여기 쌓여요</Text>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textLight }]}>함께 친 사람</Text>
            <View style={styles.chips}>
              {partners.slice(0, 8).map((p) => {
                const heavy = p.n >= 3;
                const some = p.n === 2;
                const c = heavy ? colors.danger : some ? colors.warning : colors.textSecondary;
                return (
                  <View key={p.name} style={[styles.chip, { backgroundColor: c + '14' }]}>
                    <Text style={[styles.chipName, { color: colors.text }]}>{p.name}</Text>
                    <Text style={[styles.chipN, { color: c }]}>{p.n}</Text>
                  </View>
                );
              })}
              {partners.length > 8 && (
                <Text style={[styles.more, { color: colors.textLight }]}>+{partners.length - 8}</Text>
              )}
            </View>
            <Text style={[styles.tapHint, { color: colors.primary }]}>탭하면 몇 시에 쳤는지 자세히 →</Text>
          </>
        )}
      </Pressable>
      {open && <GameLog clubSessionId={clubSessionId} meOnlyDefault onClose={() => setOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '800' },
  count: { fontSize: 15, fontWeight: '800' },
  empty: { ...typography.caption, marginTop: 2 },
  label: { ...typography.caption, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  chipName: { fontSize: 12.5, fontWeight: '700' },
  chipN: { fontSize: 12.5, fontWeight: '900' },
  more: { fontSize: 12, fontWeight: '700', alignSelf: 'center' },
  tapHint: { ...typography.caption, fontWeight: '700', marginTop: 4 },
});
