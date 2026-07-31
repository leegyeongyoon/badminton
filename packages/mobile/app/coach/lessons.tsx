import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, type MyCoachLessonRow } from '../../services/coach';

// ─────────────────────────────────────────────────────────────
// 내 레슨(코치) — 내 프로필이 연결된 레슨 목록 → 레슨 상세(로스터·출석)로.
// ─────────────────────────────────────────────────────────────

export default function CoachLessons() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<MyCoachLessonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await coachApi.myLessons());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>내 레슨</Text>
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
              <Ionicons name="school-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 연결된 레슨이 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                모임 운영진이 레슨 개설에서 내 프로필을 연결하면{'\n'}여기서 수강생과 출석을 관리할 수 있어요
              </Text>
            </View>
          ) : (
            rows.map((r) => (
              <Pressable
                key={r.offerId}
                onPress={() => router.push(`/club/${r.clubId}/lesson/${r.offerId}` as never)}
                style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, shadows.md, !r.enabled && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.headRow}>
                    <Text style={[styles.clubName, { color: colors.text }]} numberOfLines={1}>{r.clubName}</Text>
                    {!r.enabled && <Text style={[styles.pausedTag, { color: colors.textLight }]}>모집 중지</Text>}
                  </View>
                  <Text style={[styles.summary, { color: colors.textSecondary }]}>{r.summary}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.meta, { color: colors.textLight }]}>
                      수강생 {r.students}{r.capacity ? ` / ${r.capacity}` : ''}명
                    </Text>
                    {r.fee != null && <Text style={[styles.meta, { color: colors.textLight }]}>월 {r.fee.toLocaleString()}원</Text>}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 18, padding: spacing.lg, marginBottom: spacing.sm + 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  clubName: { fontSize: 15.5, fontWeight: '800', flexShrink: 1 },
  pausedTag: { fontSize: 11, fontWeight: '800' },
  summary: { ...typography.body2, fontWeight: '700', marginTop: 3 },
  metaRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  meta: { fontSize: 12.5, fontWeight: '600' },
});
