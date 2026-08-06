import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { coachApi, type CoachCard } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';
import { Tag } from '../ui/Tag';
import { FilterSheet, EMPTY_FILTER, countFilters, type MarketFilter } from './FilterSheet';

// ─────────────────────────────────────────────────────────────
// 코치 목록(코치 찾기) — 코치 허브 탭에서 쓰는 자체 로딩 컴포넌트.
// 신뢰 톤: 검색 + [필터] 시트(지역·급수·인증·가격), 회색 위계 카드.
// ─────────────────────────────────────────────────────────────

function priceLabel(c: CoachCard): string | null {
  if (c.pricePerMonth) return `월 ${c.pricePerMonth.toLocaleString()}원`;
  if (c.pricePerSession) return `회당 ${c.pricePerSession.toLocaleString()}원`;
  return null;
}

export function CoachList({ bottomPad = 40 }: { bottomPad?: number }) {
  const { colors } = useTheme();
  const router = useRouter();

  const [coaches, setCoaches] = useState<CoachCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<MarketFilter>(EMPTY_FILTER);
  const [showFilter, setShowFilter] = useState(false);

  const load = useCallback(async () => {
    try {
      setCoaches(await coachApi.list({
        regions: filter.regions,
        skills: filter.skills,
        certifiedOnly: filter.certifiedOnly,
        maxPrice: filter.maxPrice,
      }));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  // 카드 하트 토글(옵티미스틱).
  const toggleBookmark = (c: CoachCard) => {
    setCoaches((prev) => prev.map((x) => (x.id === c.id ? { ...x, bookmarked: !c.bookmarked } : x)));
    coachApi.setBookmark(c.id, !c.bookmarked).catch(() => {
      setCoaches((prev) => prev.map((x) => (x.id === c.id ? { ...x, bookmarked: c.bookmarked } : x)));
    });
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return coaches.filter((c) => {
      if (!query) return true;
      return [c.displayName, c.intro, c.regions, c.regionCodes.join(' ')].some((v) => (v || '').toLowerCase().includes(query));
    });
  }, [coaches, q]);

  const filterCount = countFilters(filter, true);

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
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={15} color={colors.textLight} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={q}
            onChangeText={setQ}
            placeholder="코치 이름, 지역 검색"
            placeholderTextColor={colors.textLight}
          />
        </View>
        <Pressable
          onPress={() => setShowFilter(true)}
          style={[styles.filterBtn, { borderColor: filterCount > 0 ? colors.text : colors.border, backgroundColor: colors.surface }]}
        >
          <Ionicons name="options-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.filterBtnText, { color: colors.textSecondary }]}>필터</Text>
          {filterCount > 0 && (
            <View style={[styles.filterCount, { backgroundColor: colors.text }]}>
              <Text style={styles.filterCountText}>{filterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={{ height: spacing.md }} />

      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="school-outline" size={34} color={colors.textLight} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {coaches.length === 0 && filterCount === 0 && !q.trim()
              ? '아직 등록된 코치가 없어요'
              : '조건에 맞는 코치가 없어요'}
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
          // 신뢰 라인 — 구력·입상·진행 레슨 (인증·급수는 이름 옆으로).
          const trust = [
            c.playingYears != null ? `구력 ${c.playingYears}년` : null,
            c.awardCount > 0 ? `입상 ${c.awardCount}회` : null,
            c.lessonCount > 0 ? `진행 레슨 ${c.lessonCount}` : null,
          ].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/coach/${c.id}` as never)}
              style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.92 }]}
            >
              <View style={styles.cardTop}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, styles.photoFallback, { backgroundColor: colors.surface2 }]}>
                    <Text style={[styles.photoInitial, { color: colors.textSecondary }]}>{c.displayName.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{c.displayName}</Text>
                    {!!c.skillLevel && <Tag label={`${c.skillLevel}조`} />}
                    {c.certified && <Ionicons name="checkmark-circle" size={15} color={colors.primary} />}
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={() => toggleBookmark(c)} hitSlop={10}>
                      <Ionicons name={c.bookmarked ? 'heart' : 'heart-outline'} size={18} color={c.bookmarked ? colors.danger : colors.textLight} />
                    </Pressable>
                  </View>
                  {c.ratingCount > 0 && c.ratingAvg != null && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={12} color="#F5A623" />
                      <Text style={[styles.ratingText, { color: colors.text }]}>{c.ratingAvg.toFixed(1)}</Text>
                      <Text style={[styles.ratingCount, { color: colors.textLight }]}>({c.ratingCount})</Text>
                    </View>
                  )}
                  {!!c.intro && <Text style={[styles.intro, { color: colors.textSecondary }]} numberOfLines={2}>{c.intro}</Text>}
                  {!!trust && <Text style={[styles.trust, { color: colors.textLight }]} numberOfLines={1}>{trust}</Text>}
                </View>
              </View>
              <View style={[styles.cardFoot, { borderTopColor: colors.divider }]}>
                <Text style={[styles.region, { color: colors.textLight }]} numberOfLines={1}>
                  {[c.regionCodes.join('·'), c.regions].filter(Boolean).join(' · ')}
                </Text>
                {price && <Text style={[styles.price, { color: colors.text }, typography.tabular]}>{price}</Text>}
              </View>
            </Pressable>
          );
        })
      )}

      <FilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        value={filter}
        onApply={setFilter}
        showCoachFilters
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'web' ? 9 : 8 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '400', padding: 0 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 9 },
  filterBtnText: { fontSize: 13, fontWeight: '600' },
  filterCount: { minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  filterCountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center' },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 10 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  photo: { width: 64, height: 64, borderRadius: 10 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoInitial: { fontSize: 22, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  ratingText: { fontSize: 13, fontWeight: '700' },
  ratingCount: { fontSize: 12, fontWeight: '400' },
  intro: { fontSize: 14, fontWeight: '400', lineHeight: 20, marginTop: 3 },
  trust: { fontSize: 12, fontWeight: '400', marginTop: 5 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingTop: spacing.md },
  region: { fontSize: 12, fontWeight: '400', flexShrink: 1, marginRight: spacing.md },
  price: { fontSize: 15, fontWeight: '700' },
});
