import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { alpha } from '../utils/color';
import { BackButton } from '../components/ui/BackButton';
import { Icon } from '../components/ui/Icon';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ─────────────────────────────────────────────────────────────
// 모임 찾기 — PUBLIC(공개) 모임 탐색. 카드 탭 → 게스트 신청(모임 미리보기).
// 가입은 여전히 초대코드로만(탐색은 게스트 신청 진입용).
// ─────────────────────────────────────────────────────────────

interface DiscoverClubRow {
  clubId: string;
  name: string;
  description: string | null;
  memberCount: number;
  region: string | null;
  guestFee: number | null;
  duesPeriodType: string;
  scheduleSummary: string | null;
  applyOpen: boolean;
  address: string | null;
  lat: number | null;
  lng: number | null;
  hasLessons: boolean;
  clubType: string;
  coaches: { coachName: string; coachIntro: string | null; fee: number | null; days: number[]; start: string; end: string }[];
}

export default function Discover() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DiscoverClubRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<string | null>(null); // null = 전체
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const { isAuthenticated } = useAuthStore();

  // 내 위치(선택) — 허용하면 거리 표시 + 가까운 순 정렬. 웹은 브라우저 geolocation.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { timeout: 5000 },
      );
    } else if (Platform.OS !== 'web') {
      import('expo-location')
        .then(async (Location) => {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        })
        .catch(() => {});
    }
  }, []);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      // 비로그인(공개 웹)도 탐색 가능 — 공개 엔드포인트(rate-limit) 사용.
      const path = isAuthenticated ? '/clubs/discover' : '/clubs/discover-public';
      const { data } = await api.get(path, { params: q ? { query: q } : {}, _silent: true } as any);
      setRows(data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>모임 찾기</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/map' as never)}
          style={({ pressed }) => [styles.mapBtn, { backgroundColor: colors.primaryBg }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="map-outline" size={15} color={colors.primary} />
          <Text style={[styles.mapBtnText, { color: colors.primary }]}>지도</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }} keyboardShouldPersistTaps="handled">
        {/* 검색 */}
        <View style={[styles.searchRow, { backgroundColor: colors.surface }, shadows.sm]}>
          <Icon name="search" size={18} color={colors.textLight} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => load(query.trim() || undefined)}
            placeholder="모임 이름·소개 검색"
            placeholderTextColor={colors.textLight}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(''); load(); }} hitSlop={8}>
              <Text style={{ color: colors.textLight, fontWeight: '700' }}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* 결과 수 */}
        {!loading && (rows ?? []).length > 0 && (
          <Text style={[styles.resultCount, { color: colors.textLight }]}>
            공개 모임 {(rows ?? []).filter((c) => !regionFilter || c.region === regionFilter).length}개 · 카드를 누르면 게스트 신청으로 이동해요
          </Text>
        )}

        {/* 지역 필터 — 결과에서 파생된 지역 칩 */}
        {(rows ?? []).length > 0 && (() => {
          const regions = [...new Set((rows ?? []).map((c) => c.region).filter(Boolean))] as string[];
          if (regions.length < 2) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
              {[null, ...regions].map((r) => {
                const active = regionFilter === r;
                return (
                  <Pressable
                    key={r ?? '전체'}
                    onPress={() => setRegionFilter(r)}
                    style={[styles.regionChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface }]}
                  >
                    <Text style={[styles.regionChipText, { color: active ? '#fff' : colors.textSecondary }]}>{r ?? '전체'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          );
        })()}

        {loading && rows == null ? (
          <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (rows ?? []).length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>공개된 모임이 아직 없어요</Text>
            <Text style={[styles.emptySub, { color: colors.textLight }]}>초대코드가 있다면 홈의 '모임 참여'로 가입할 수 있어요</Text>
          </View>
        ) : (
          (() => {
            const kmOf = (c: DiscoverClubRow): number | null => {
              if (!myLoc || c.lat == null || c.lng == null) return null;
              const R = 6371, dLat = (c.lat - myLoc.lat) * Math.PI / 180, dLng = (c.lng - myLoc.lng) * Math.PI / 180;
              const a = Math.sin(dLat / 2) ** 2 + Math.cos(myLoc.lat * Math.PI / 180) * Math.cos(c.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            };
            const list = (rows ?? [])
              .filter((c) => !regionFilter || c.region === regionFilter)
              .map((c) => ({ c, km: kmOf(c) }))
              .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
            return list.map(({ c, km }) => (
            <Pressable
              key={c.clubId}
              onPress={() => router.push(`/guest-apply?clubId=${c.clubId}` as any)}
              style={({ pressed }) => [styles.card, { backgroundColor: colors.surface }, shadows.md, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
            >
              <View style={styles.cardHead}>
                <View style={[styles.avatar, { backgroundColor: alpha(colors.primary, 0.12) }]}>
                  <Text style={[styles.avatarText, { color: colors.primary }]}>{c.name[0]}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                    <View style={[styles.typeBadge, { backgroundColor: c.clubType === 'MEETUP' ? colors.warning + '18' : colors.primaryBg }]}>
                      <Text style={[styles.typeBadgeText, { color: c.clubType === 'MEETUP' ? colors.warning : colors.primary }]}>
                        {c.clubType === 'MEETUP' ? '번개' : '클럽'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.metaRow}>
                    {!!c.region && (
                      <View style={styles.metaItem}>
                        <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                        <Text style={[styles.metaText, { color: colors.textSecondary }]}>{c.region}</Text>
                      </View>
                    )}
                    <View style={styles.metaItem}>
                      <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.metaText, { color: colors.textSecondary }]}>멤버 {c.memberCount}명</Text>
                    </View>
                    {c.guestFee != null && (
                      <View style={styles.metaItem}>
                        <Ionicons name="card-outline" size={12} color={colors.textSecondary} />
                        <Text style={[styles.metaText, { color: colors.textSecondary }]}>게스트비 {c.guestFee.toLocaleString()}원</Text>
                      </View>
                    )}
                    {km != null && (
                      <View style={styles.metaItem}>
                        <Ionicons name="navigate-outline" size={12} color={colors.primary} />
                        <Text style={[styles.metaText, { color: colors.primary }]}>{km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.applyTag, { backgroundColor: c.applyOpen ? colors.primaryBg : colors.surfaceSecondary }]}>
                    <Text style={[styles.applyTagText, { color: c.applyOpen ? colors.primary : colors.textLight }]}>
                      {c.applyOpen ? '게스트 신청' : '신청 마감'}
                    </Text>
                  </View>
                  {c.hasLessons && (
                    <View style={[styles.applyTag, { backgroundColor: colors.info + '18' }]}>
                      <Text style={[styles.applyTagText, { color: colors.info }]}>레슨 모집</Text>
                    </View>
                  )}
                </View>
              </View>
              {c.scheduleSummary && (
                <View style={[styles.scheduleLine, { backgroundColor: alpha(colors.primary, 0.07) }]}>
                  <Ionicons name="calendar-outline" size={13} color={colors.primary} />
                  <Text style={[styles.scheduleLineText, { color: colors.primary }]} numberOfLines={1}>{c.scheduleSummary}</Text>
                </View>
              )}
              {c.description && (
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{c.description}</Text>
              )}
              {c.coaches.length > 0 && (
                <View style={[styles.coachLine, { backgroundColor: colors.info + '10' }]}>
                  <Ionicons name="school-outline" size={13} color={colors.info} />
                  <Text style={[styles.coachLineText, { color: colors.info }]} numberOfLines={1}>
                    {c.coaches.map((co) => `${co.coachName} 코치${co.fee != null ? ` 월${Math.round(co.fee / 10000)}만` : ''}`).join(' · ')}
                  </Text>
                </View>
              )}
              {!!c.address && (
                <Pressable
                  onPress={() => {
                    const url = `https://map.kakao.com/link/search/${encodeURIComponent(c.address!)}`;
                    Linking.openURL(url).catch(() => {});
                  }}
                  style={({ pressed }) => [styles.mapRow, pressed && { opacity: 0.7 }]}
                  hitSlop={4}
                >
                  <Ionicons name="map-outline" size={13} color={colors.textSecondary} />
                  <Text style={[styles.mapRowText, { color: colors.textSecondary }]} numberOfLines={1}>{c.address}</Text>
                  <Text style={[styles.mapRowLink, { color: colors.primary }]}>지도</Text>
                </Pressable>
              )}
            </Pressable>
            ));
          })()
        )}
        <Text style={[styles.note, { color: colors.textLight }]}>* 공개로 설정한 모임만 보여요. 모임 가입은 초대코드로만 가능해요.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.h3 },
  center: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.xs },
  emptyTitle: { ...typography.subtitle2 },
  emptySub: { ...typography.caption },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.full, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: { ...typography.body1, flex: 1, paddingVertical: spacing.smd },
  card: { padding: spacing.lg, borderRadius: 20, marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 19, fontWeight: '900' },
  cardTitle: { ...typography.subtitle1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap', marginTop: 3 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { ...typography.caption, fontWeight: '700' },
  scheduleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md },
  scheduleLineText: { ...typography.caption, fontWeight: '800', flex: 1 },
  cardDesc: { ...typography.caption, marginTop: spacing.sm, lineHeight: 17 },
  resultCount: { ...typography.caption, marginBottom: spacing.sm },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  mapRowText: { ...typography.caption, flex: 1 },
  mapRowLink: { ...typography.caption, fontWeight: '800' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 999 },
  mapBtnText: { fontSize: 13, fontWeight: '800' },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  typeBadgeText: { fontSize: 10, fontWeight: '900' },
  coachLine: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm },
  coachLineText: { ...typography.caption, fontWeight: '800', flex: 1 },
  applyTag: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  applyTagText: { fontSize: 11, fontWeight: '800' },
  note: { ...typography.caption, marginTop: spacing.sm, lineHeight: 16 },
  regionChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  regionChipText: { ...typography.body2, fontWeight: '800' },
});
