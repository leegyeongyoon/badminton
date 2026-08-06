import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { getSkillMeta } from '../../constants/skill';
import { coachJobApi, ddayLabel, type JobPostCard } from '../../services/coachJob';
import { coachApi, type CoachCard } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';

// ─────────────────────────────────────────────────────────────
// 찜 목록 — [공고 | 코치] 탭. 하트 해제 시 목록에서 바로 제거.
// ─────────────────────────────────────────────────────────────

export default function BookmarksScreen() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'jobs' | 'coaches'>('jobs');
  const [jobs, setJobs] = useState<JobPostCard[]>([]);
  const [coaches, setCoaches] = useState<CoachCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([coachJobApi.bookmarks(), coachApi.bookmarks()]);
      setJobs(j);
      setCoaches(c);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const removeJob = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    coachJobApi.setBookmark(id, false).catch(() => load());
  };
  const removeCoach = (id: string) => {
    setCoaches((prev) => prev.filter((c) => c.id !== id));
    coachApi.setBookmark(id, false).catch(() => load());
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>찜 목록</Text>
      </View>

      <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {([
          { key: 'jobs', label: `공고 ${jobs.length}` },
          { key: 'coaches', label: `코치 ${coaches.length}` },
        ] as const).map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.segmentBtn, on && { backgroundColor: colors.primary }]}>
              <Text style={[styles.segmentText, { color: on ? '#fff' : colors.textSecondary }]}>{t.label}</Text>
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
          {tab === 'jobs' ? (
            jobs.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="heart-outline" size={34} color={colors.textLight} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>찜한 공고가 없어요</Text>
                <Text style={[styles.emptyHint, { color: colors.textLight }]}>공고 카드의 하트를 누르면 여기에 모여요</Text>
              </View>
            ) : (
              jobs.map((j) => {
                const dd = ddayLabel(j.deadline);
                return (
                  <Pressable
                    key={j.id}
                    onPress={() => router.push(`/market/job/${j.id}` as never)}
                    style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, j.status === 'CLOSED' && { opacity: 0.55 }, pressed && { opacity: 0.9 }]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.headRow}>
                        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{j.title}</Text>
                        {j.status === 'CLOSED' ? (
                          <Text style={[styles.tag, { color: colors.textLight }]}>마감</Text>
                        ) : dd ? (
                          <Text style={[styles.tag, { color: dd.urgent ? colors.danger : colors.textSecondary }]}>{dd.label}</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                        {j.clubName ?? '개인 요청'} · {j.region} · {j.payLabel}
                      </Text>
                    </View>
                    <Pressable onPress={() => removeJob(j.id)} hitSlop={10}>
                      <Ionicons name="heart" size={20} color={colors.danger} />
                    </Pressable>
                  </Pressable>
                );
              })
            )
          ) : coaches.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="heart-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>찜한 코치가 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>코치 카드의 하트를 누르면 여기에 모여요</Text>
            </View>
          ) : (
            coaches.map((c) => {
              const photo = absolutizeUploadUrl(c.photoUrl);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/coach/${c.id}` as never)}
                  style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.9 }]}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.photo} />
                  ) : (
                    <View style={[styles.photo, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ color: colors.textSecondary, fontSize: 18, fontWeight: '700' }}>{c.displayName.slice(0, 1)}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.headRow}>
                      <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{c.displayName}</Text>
                      {!!c.skillLevel && (
                        <View style={[styles.skillBadge, { backgroundColor: colors.surface2 }]}>
                          <Text style={[styles.skillBadgeText, { color: colors.textSecondary }]}>{c.skillLevel}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {[
                        c.ratingCount > 0 && c.ratingAvg != null ? `★ ${c.ratingAvg.toFixed(1)} (${c.ratingCount})` : null,
                        c.regionCodes.join('·') || null,
                        c.pricePerMonth ? `월 ${c.pricePerMonth.toLocaleString()}원` : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeCoach(c.id)} hitSlop={10}>
                    <Ionicons name="heart" size={20} color={colors.danger} />
                  </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginTop: spacing.md, maxWidth: 640, width: '92%', alignSelf: 'center' },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  tag: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 3 },
  photo: { width: 46, height: 46, borderRadius: 12 },
  skillBadge: { minWidth: 20, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  skillBadgeText: { fontSize: 11, fontWeight: '700' },
});
