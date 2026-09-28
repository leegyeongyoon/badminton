import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useAuthStore } from '../../store/authStore';
import { typography, spacing, radius } from '../../constants/theme';
import { clubSessionApi, type SessionGameLogRow } from '../../services/clubSession';
import { PairGraph } from './PairGraph';

// ─────────────────────────────────────────────────────────────
// 정모 게임 기록 — 시작시간 순으로 "몇 시에 누구랑 쳤는지". 내 게임만 보기 토글,
// 각 게임 탭하면 중복 점검(짝 선 그래프) 팝업. 운영진·회원 공용.
// meOnlyDefault=true 면 열 때 '내 게임만'으로 시작(회원용).
// ─────────────────────────────────────────────────────────────

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${String(m).padStart(2, '0')}`;
}

export function GameLog({ clubSessionId, onClose, meOnlyDefault }: { clubSessionId: string; onClose: () => void; meOnlyDefault?: boolean }) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const myId = user?.id;

  const [rows, setRows] = useState<SessionGameLogRow[] | null>(null);
  const [meOnly, setMeOnly] = useState(!!meOnlyDefault);
  const [graphRow, setGraphRow] = useState<SessionGameLogRow | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await clubSessionApi.gameLog(clubSessionId));
    } catch {
      setRows([]);
    }
  }, [clubSessionId]);
  useEffect(() => { load(); }, [load]);

  // 짝별 함께 친 횟수(전체 기록에서) — 그래프용.
  const pairCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of rows ?? []) {
      const ids = g.players.map((p) => p.userId);
      for (let i = 0; i < ids.length; i += 1)
        for (let j = i + 1; j < ids.length; j += 1) {
          const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
          m.set(k, (m.get(k) || 0) + 1);
        }
    }
    return (a: string, b: string) => m.get(a < b ? `${a}|${b}` : `${b}|${a}`) || 0;
  }, [rows]);

  const shown = useMemo(
    () => (meOnly && myId ? (rows ?? []).filter((g) => g.players.some((p) => p.userId === myId)) : rows ?? []),
    [rows, meOnly, myId],
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>📋 게임 기록</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textLight} /></Pressable>
          </View>
          {myId && (
            <View style={styles.tabs}>
              {[{ k: false, l: '전체' }, { k: true, l: '내 게임' }].map((t) => {
                const on = meOnly === t.k;
                return (
                  <Pressable key={t.l} onPress={() => setMeOnly(t.k)} style={[styles.tab, on && { backgroundColor: colors.primary }]}>
                    <Text style={[styles.tabText, { color: on ? '#fff' : colors.textSecondary }]}>{t.l}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {rows === null ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : shown.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textLight }]}>
              {meOnly ? '오늘 아직 친 게임이 없어요' : '아직 시작된 게임이 없어요'}
            </Text>
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
              {shown.map((g) => (
                <Pressable
                  key={g.turnId}
                  onPress={() => setGraphRow(g)}
                  style={[styles.card, shadows.sm, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={styles.cardTop}>
                    <Text style={[styles.time, { color: colors.text }]}>{hhmm(g.startedAt)}</Text>
                    <Text style={[styles.court, { color: colors.textLight }]}>{g.courtName}</Text>
                    {g.status === 'PLAYING' && (
                      <View style={[styles.liveTag, { backgroundColor: colors.danger + '18' }]}>
                        <Text style={[styles.liveText, { color: colors.danger }]}>진행 중</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <Ionicons name="git-network-outline" size={15} color={colors.textLight} />
                  </View>
                  <View style={styles.players}>
                    {g.players.map((p) => {
                      const me = p.userId === myId;
                      return (
                        <View key={p.userId} style={[styles.pchip, { backgroundColor: me ? colors.primaryBg : colors.surfaceSecondary }]}>
                          <Text style={[styles.pname, { color: me ? colors.primary : colors.textSecondary, fontWeight: me ? '800' : '600' }]}>
                            {p.name}{me ? ' (나)' : ''}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </Pressable>
              ))}
              <Text style={[styles.hint, { color: colors.textLight }]}>게임을 탭하면 4명 중복 점검(선 그래프)이 보여요</Text>
            </ScrollView>
          )}
        </View>
      </View>

      {/* 중복 점검 그래프 */}
      {graphRow && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setGraphRow(null)}>
          <Pressable style={styles.gBackdrop} onPress={() => setGraphRow(null)}>
            <Pressable style={[styles.gSheet, { backgroundColor: colors.surface }]}>
              <Text style={[styles.gTitle, { color: colors.text }]}>🔁 {hhmm(graphRow.startedAt)} 게임 · 중복 점검</Text>
              <PairGraph
                players={graphRow.players.map((p) => ({ id: p.userId, name: p.name }))}
                pairCount={pairCount}
                size={260}
              />
              <Text style={[styles.gLegend, { color: colors.textLight }]}>
                선 = 함께 친 횟수 · <Text style={{ color: colors.danger }}>빨강 2회+</Text> · <Text style={{ color: colors.warning }}>주황 1회</Text>
              </Text>
              <Pressable onPress={() => setGraphRow(null)} style={[styles.gClose, { backgroundColor: colors.primary }]}>
                <Text style={styles.gCloseText}>닫기</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '86%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center', backgroundColor: 'transparent' },
  tabText: { fontSize: 13.5, fontWeight: '800' },
  empty: { ...typography.body2, textAlign: 'center', paddingVertical: spacing.xxl },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { fontSize: 15, fontWeight: '800' },
  court: { fontSize: 12.5, fontWeight: '600' },
  liveTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  liveText: { fontSize: 10.5, fontWeight: '800' },
  players: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pchip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  pname: { fontSize: 13 },
  hint: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
  gBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  gSheet: { width: '100%', maxWidth: 400, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  gTitle: { fontSize: 15, fontWeight: '800', marginBottom: spacing.md, textAlign: 'center' },
  gLegend: { ...typography.caption, textAlign: 'center', marginTop: spacing.md },
  gClose: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center', marginTop: spacing.md, alignSelf: 'stretch' },
  gCloseText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
