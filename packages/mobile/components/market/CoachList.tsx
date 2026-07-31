import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { getSkillMeta } from '../../constants/skill';
import { REGIONS } from '../../constants/regions';
import { coachApi, type CoachCard } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';

// ─────────────────────────────────────────────────────────────
// 코치 목록(코치 찾기) — 코치 허브의 세그먼트에서 쓰는 자체 로딩 컴포넌트.
// 검색·지역 칩·카드 목록. (기존 coaches.tsx 화면에서 추출)
// ─────────────────────────────────────────────────────────────

function priceLabel(c: CoachCard): string | null {
  if (c.pricePerMonth) return `월 ${c.pricePerMonth.toLocaleString()}원`;
  if (c.pricePerSession) return `회당 ${c.pricePerSession.toLocaleString()}원`;
  return null;
}

export function CoachList({ bottomPad = 40 }: { bottomPad?: number }) {
  const { colors, shadows } = useTheme();
  const router = useRouter();

  const [coaches, setCoaches] = useState<CoachCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [regionFilter, setRegionFilter] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setCoaches(await coachApi.list({ regions: regionFilter }));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [regionFilter]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return coaches.filter((c) => {
      if (!query) return true;
      return [c.displayName, c.intro, c.regions, c.regionCodes.join(' ')].some((v) => (v || '').toLowerCase().includes(query));
    });
  }, [coaches, q]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPad, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search" size={16} color={colors.textLight} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={q}
          onChangeText={setQ}
          placeholder="코치 이름, 지역 검색"
          placeholderTextColor={colors.textLight}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
        <Pressable
          onPress={() => setRegionFilter([])}
          style={[styles.chip, { backgroundColor: regionFilter.length === 0 ? colors.text : colors.surface, borderColor: regionFilter.length === 0 ? colors.text : colors.border }]}
        >
          <Text style={[styles.chipText, { color: regionFilter.length === 0 ? '#fff' : colors.textSecondary }]}>전국</Text>
        </Pressable>
        {REGIONS.map((r) => {
          const on = regionFilter.includes(r);
          return (
            <Pressable
              key={r}
              onPress={() => setRegionFilter((prev) => (on ? prev.filter((x) => x !== r) : [...prev, r]))}
              style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
            >
              <Text style={[styles.chipText, { color: on ? '#fff' : colors.textSecondary }]}>{r}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ height: spacing.sm }} />

      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="school-outline" size={34} color={colors.textLight} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {coaches.length === 0 ? '아직 등록된 코치가 없어요' : '조건에 맞는 코치가 없어요'}
          </Text>
          <Text style={[styles.emptyHint, { color: colors.textLight }]}>레슨 경력이 있다면 이력서를 등록해 보세요</Text>
          <Pressable onPress={() => router.push('/coach/edit' as never)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.emptyBtnText}>코치로 활동하기</Text>
          </Pressable>
        </View>
      ) : (
        filtered.map((c) => {
          const photo = absolutizeUploadUrl(c.photoUrl);
          const price = priceLabel(c);
          // 숨고식 신뢰 라인 — 인증·구력·입상·진행 레슨을 한 줄로.
          const trust = [
            c.certified ? '인증 코치' : null,
            c.playingYears != null ? `구력 ${c.playingYears}년` : null,
            c.awardCount > 0 ? `입상 ${c.awardCount}회` : null,
            c.lessonCount > 0 ? `진행 레슨 ${c.lessonCount}` : null,
          ].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/coach/${c.id}` as never)}
              style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.cardTop}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, styles.photoFallback, { backgroundColor: colors.primary + '10' }]}>
                    <Text style={[styles.photoInitial, { color: colors.primary }]}>{c.displayName.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{c.displayName}</Text>
                    {!!c.skillLevel && (
                      <View style={[styles.skillBadge, { backgroundColor: getSkillMeta(c.skillLevel).color }]}>
                        <Text style={styles.skillBadgeText}>{c.skillLevel}</Text>
                      </View>
                    )}
                    {c.certified && <Ionicons name="checkmark-circle" size={15} color={colors.primary} />}
                  </View>
                  {!!c.intro && <Text style={[styles.intro, { color: colors.textSecondary }]} numberOfLines={2}>{c.intro}</Text>}
                  {!!trust && <Text style={[styles.trust, { color: colors.textLight }]} numberOfLines={1}>{trust}</Text>}
                </View>
              </View>
              <View style={[styles.cardFoot, { borderTopColor: colors.border }]}>
                <Text style={[styles.region, { color: colors.textLight }]} numberOfLines={1}>
                  {[c.regionCodes.join('·'), c.regions].filter(Boolean).join(' · ')}
                </Text>
                {price && <Text style={[styles.price, { color: colors.text }]}>{price}</Text>}
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, ...typography.body2, fontWeight: '600', paddingVertical: 9 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12.5, fontWeight: '700' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center' },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  photo: { width: 72, height: 72, borderRadius: 16 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoInitial: { fontSize: 26, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
  skillBadge: { minWidth: 21, height: 19, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  skillBadgeText: { color: '#fff', fontSize: 11.5, fontWeight: '900' },
  intro: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 3 },
  trust: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingTop: spacing.md },
  region: { fontSize: 12.5, fontWeight: '600', flexShrink: 1, marginRight: spacing.md },
  price: { fontSize: 15.5, fontWeight: '900' },
});
