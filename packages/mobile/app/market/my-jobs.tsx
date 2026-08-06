import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachJobApi, type MyJobRow } from '../../services/coachJob';

// 내 공고 관리 — 내가 올린 구인 공고 + 지원자 수·신규 지원 표시.

export default function MyJobs() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<MyJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await coachJobApi.mine());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>채용 관리</Text>
        <Pressable onPress={() => router.push('/market/job/new' as never)} hitSlop={8}>
          <Text style={[styles.newLink, { color: colors.primary }]}>공고 올리기</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="megaphone-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>올린 공고가 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>코치가 필요하면 공고를 올려 지원을 받아보세요</Text>
            </View>
          ) : (
            rows.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/market/job/${j.id}/applicants` as never)}
                style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, shadows.md, j.status === 'CLOSED' && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.headRow}>
                    <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{j.title}</Text>
                    {j.status === 'CLOSED' && <Text style={[styles.closedTag, { color: colors.textLight }]}>마감</Text>}
                  </View>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {j.clubName ?? '개인 요청'} · {j.region} · {j.scheduleLabel}
                  </Text>
                  <View style={styles.footRow}>
                    <Text style={[styles.applicants, { color: j.applicants > 0 ? colors.text : colors.textLight }]}>조회 {j.views} · 지원자 {j.applicants}명 관리 →</Text>
                    {j.newApplicants > 0 && (
                      <View style={[styles.newBadge, { backgroundColor: colors.danger }]}>
                        <Text style={styles.newBadgeText}>새 지원 {j.newApplicants}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  newLink: { fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.sm + 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  closedTag: { fontSize: 11, fontWeight: '600' },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 3 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  applicants: { fontSize: 13, fontWeight: '600' },
  newBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  newBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
