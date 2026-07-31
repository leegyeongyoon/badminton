import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachJobApi, type MyApplicationRow } from '../../services/coachJob';

// ─────────────────────────────────────────────────────────────
// 지원 현황(원티드 MY원티드 > 지원 현황) — 상태 탭 + 단계 프로그레스.
// 지원완료 → 면접 → 최종(합격/불합격)을 카드마다 시각화한다.
// ─────────────────────────────────────────────────────────────

const TABS = [
  { key: 'ALL', label: '전체' },
  { key: 'ACTIVE', label: '진행 중' }, // APPLIED + INTERVIEW
  { key: 'DONE', label: '종료' }, // ACCEPTED + REJECTED
] as const;

const STEPS = ['지원', '면접', '오퍼레터', '최종'] as const;

function stepIndex(status: string): number {
  if (status === 'APPLIED') return 0;
  if (status === 'INTERVIEW') return 1;
  if (status === 'OFFERED') return 2;
  return 3; // ACCEPTED | REJECTED | DECLINED
}

export default function MyApplications() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<MyApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('ALL');

  const load = useCallback(async () => {
    try {
      setRows(await coachJobApi.applied());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const counts = useMemo(() => ({
    ALL: rows.length,
    ACTIVE: rows.filter((r) => ['APPLIED', 'INTERVIEW', 'OFFERED'].includes(r.status)).length,
    DONE: rows.filter((r) => ['ACCEPTED', 'REJECTED', 'DECLINED'].includes(r.status)).length,
  }), [rows]);

  const filtered = useMemo(() => {
    if (tab === 'ACTIVE') return rows.filter((r) => ['APPLIED', 'INTERVIEW', 'OFFERED'].includes(r.status));
    if (tab === 'DONE') return rows.filter((r) => ['ACCEPTED', 'REJECTED', 'DECLINED'].includes(r.status));
    return rows;
  }, [rows, tab]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>지원 현황</Text>
      </View>

      {/* 상태 탭 */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabItem, on && { borderBottomColor: colors.primary }]}>
              <Text style={[styles.tabLabel, { color: on ? colors.text : colors.textLight }]}>{t.label}</Text>
              <Text style={[styles.tabCount, { color: on ? colors.primary : colors.textLight }]}>{counts[t.key]}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="paper-plane-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {rows.length === 0 ? '아직 지원한 공고가 없어요' : '이 상태의 지원이 없어요'}
              </Text>
              {rows.length === 0 && (
                <Pressable onPress={() => router.push('/(tabs)/coach-hub' as never)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
                  <Text style={styles.emptyBtnText}>공고 보러 가기</Text>
                </Pressable>
              )}
            </View>
          ) : (
            filtered.map((r) => {
              const idx = stepIndex(r.status);
              const failed = r.status === 'REJECTED' || r.status === 'DECLINED';
              const finalColor = failed ? colors.textLight : colors.secondary;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/market/job/${r.post.id}` as never)}
                  style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
                >
                  <View style={styles.cardHead}>
                    <Text style={[styles.owner, { color: colors.primary }]} numberOfLines={1}>{r.post.clubName ?? '개인 요청'}</Text>
                    {r.post.status === 'CLOSED' && <Text style={[styles.closedTag, { color: colors.textLight }]}>공고 마감</Text>}
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{r.post.title}</Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {r.post.region} · {r.post.payLabel}
                  </Text>

                  {/* 단계 프로그레스(원티드) */}
                  <View style={styles.stepsRow}>
                    {STEPS.map((label, i) => {
                      const reached = i <= idx;
                      const isFinal = i === STEPS.length - 1;
                      const dotColor = !reached
                        ? colors.border
                        : isFinal
                          ? finalColor
                          : colors.primary;
                      const stepLabel = isFinal && idx === STEPS.length - 1
                        ? (r.status === 'ACCEPTED' ? '채용 확정' : r.status === 'DECLINED' ? '거절함' : '불합격')
                        : label;
                      return (
                        <View key={label} style={styles.step}>
                          <View style={styles.stepDotRow}>
                            {i > 0 && <View style={[styles.stepLine, { backgroundColor: i <= idx ? (isFinal ? finalColor : colors.primary) : colors.border }]} />}
                            <View style={[styles.stepDot, { backgroundColor: dotColor }]}>
                              {reached && (
                                <Ionicons
                                  name={isFinal && idx === STEPS.length - 1 ? (failed ? 'close' : 'checkmark') : 'checkmark'}
                                  size={10}
                                  color="#fff"
                                />
                              )}
                            </View>
                            {i < STEPS.length - 1 && <View style={[styles.stepLine, { backgroundColor: i < idx ? colors.primary : colors.border }]} />}
                          </View>
                          <Text style={[styles.stepLabel, { color: reached ? (isFinal ? finalColor : colors.text) : colors.textLight }]}>
                            {stepLabel}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  tabItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabLabel: { fontSize: 14, fontWeight: '800' },
  tabCount: { fontSize: 13, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  owner: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  closedTag: { fontSize: 11, fontWeight: '700' },
  cardTitle: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2, marginTop: 4 },
  meta: { fontSize: 12.5, fontWeight: '600', marginTop: 4 },
  stepsRow: { flexDirection: 'row', marginTop: spacing.lg },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDotRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  stepDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, height: 2 },
  stepLabel: { fontSize: 11, fontWeight: '800' },
});
