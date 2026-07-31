import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Linking, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { alpha } from '../utils/color';
import { BackButton } from '../components/ui/BackButton';
import { Icon } from '../components/ui/Icon';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { ClubMap } from '../components/discover/ClubMap';

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
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [viewMode, setViewMode] = useState<'list' | 'map'>(view === 'map' ? 'map' : 'list');
  const [selected, setSelected] = useState<DiscoverClubRow | null>(null);
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
        <Pressable onPress={() => router.push('/coaches' as never)} hitSlop={8} style={{ marginRight: spacing.sm }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>코치 찾기</Text>
        </Pressable>
        <View style={[styles.viewToggle, { backgroundColor: colors.background }]}>
          {([
            { key: 'list' as const, icon: 'list-outline' as const, label: '목록' },
            { key: 'map' as const, icon: 'map-outline' as const, label: '지도' },
          ]).map((v) => {
            const active = viewMode === v.key;
            return (
              <Pressable
                key={v.key}
                onPress={() => { setViewMode(v.key); setSelected(null); }}
                style={[styles.viewToggleBtn, active && { backgroundColor: colors.surface }, active && shadows.sm]}
              >
                <Ionicons name={v.icon} size={14} color={active ? colors.primary : colors.textLight} />
                <Text style={[styles.viewToggleText, { color: active ? colors.primary : colors.textLight }]}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {viewMode === 'map' ? (
        <View style={{ flex: 1 }}>
          <ClubMap
            pins={(rows ?? []).map((c) => ({ clubId: c.clubId, name: c.name, lat: c.lat, lng: c.lng, hasLessons: c.hasLessons }))}
            myLoc={myLoc}
            onSelectClub={(id) => setSelected((rows ?? []).find((c) => c.clubId === id) ?? null)}
          />
          {(rows ?? []).filter((c) => c.lat != null).length === 0 && (
            <View style={[styles.mapEmptyOverlay, { backgroundColor: colors.surface }, shadows.md]}>
              <Text style={[styles.mapEmptyText, { color: colors.textSecondary }]}>위치가 등록된 공개 모임이 아직 없어요</Text>
            </View>
          )}

          {/* 핀 선택 → 프로필 시트 (라벨-값 구조, 절제된 톤) */}
          {selected && (
            <View style={[styles.sheet, { backgroundColor: colors.surface }, shadows.xl]}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>{selected.name}</Text>
                    <Text style={[styles.sheetType, { color: colors.textLight }]}>{selected.clubType === 'MEETUP' ? '번개 모임' : '정기 클럽'}</Text>
                  </View>
                  <Text style={[styles.sheetSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[selected.region, `멤버 ${selected.memberCount}명`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={() => setSelected(null)} hitSlop={10} style={styles.sheetClose}>
                  <Ionicons name="close" size={18} color={colors.textLight} />
                </Pressable>
              </View>

              <View style={[styles.sheetDivider, { backgroundColor: colors.border }]} />

              {!!selected.scheduleSummary && (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.textLight }]}>일정</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={2}>{selected.scheduleSummary}</Text>
                </View>
              )}
              {selected.guestFee != null && (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.textLight }]}>게스트비</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>{selected.guestFee.toLocaleString()}원</Text>
                </View>
              )}
              {!!selected.address && (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.textLight }]}>위치</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>{selected.address}</Text>
                </View>
              )}

              {selected.coaches.length > 0 && (
                <>
                  <Text style={[styles.sheetSection, { color: colors.textLight }]}>코치 프로필</Text>
                  {selected.coaches.map((co, i) => (
                    <View key={i} style={[styles.sheetCoach, { backgroundColor: colors.background }]}>
                      <View style={[styles.sheetCoachAvatar, { backgroundColor: colors.surface }]}>
                        <Text style={[styles.sheetCoachAvatarText, { color: colors.text }]}>{co.coachName[0]}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={[styles.sheetCoachName, { color: colors.text }]}>{co.coachName}</Text>
                          {co.fee != null && <Text style={[styles.sheetCoachFee, { color: colors.text }]}>월 {co.fee.toLocaleString()}원</Text>}
                        </View>
                        {!!co.coachIntro && (
                          <Text style={[styles.sheetCoachIntro, { color: colors.textSecondary }]} numberOfLines={2}>{co.coachIntro}</Text>
                        )}
                        <Text style={[styles.sheetCoachTime, { color: colors.textLight }]}>
                          {co.days.map((d) => ['일','월','화','수','목','금','토'][d]).join('·')} {co.start}~{co.end}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              <View style={styles.sheetActions}>
                <Pressable
                  onPress={() => router.push(`/guest-apply?clubId=${selected.clubId}` as any)}
                  style={({ pressed }) => [styles.sheetBtnPrimary, { backgroundColor: colors.primary }, pressed && { opacity: 0.9 }]}
                >
                  <Text style={styles.sheetBtnPrimaryText}>게스트 신청</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/guest-chat?clubId=${selected.clubId}` as any)}
                  style={({ pressed }) => [styles.sheetBtnGhost, { borderColor: colors.border }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.sheetBtnGhostText, { color: colors.text }]}>문의</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : (
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
                    <Text style={[styles.typeText, { color: colors.textLight }]}>{c.clubType === 'MEETUP' ? '번개 모임' : '정기 클럽'}</Text>
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
                <View style={[styles.coachBox, { backgroundColor: colors.background }]}>
                  <Text style={[styles.coachBoxLabel, { color: colors.textLight }]}>코치 프로필</Text>
                  {c.coaches.map((co, ci) => (
                    <View key={ci} style={styles.coachRow}>
                      <View style={[styles.coachAvatar, { backgroundColor: colors.surface }]}>
                        <Text style={[styles.coachAvatarText, { color: colors.text }]}>{co.coachName[0]}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={[styles.coachRowName, { color: colors.text }]} numberOfLines={1}>{co.coachName}</Text>
                          {co.fee != null && <Text style={[styles.coachRowFee, { color: colors.text }]}>월 {co.fee.toLocaleString()}원</Text>}
                        </View>
                        {!!co.coachIntro && (
                          <Text style={[styles.coachRowIntro, { color: colors.textSecondary }]} numberOfLines={1}>{co.coachIntro}</Text>
                        )}
                      </View>
                    </View>
                  ))}
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
              {/* 카드 안에서 바로 액션 — 신청/문의 (깊이 축소) */}
              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => router.push(`/guest-apply?clubId=${c.clubId}` as any)}
                  style={({ pressed }) => [styles.cardActionBtn, { backgroundColor: c.applyOpen ? colors.primary : colors.surfaceSecondary }, pressed && { opacity: 0.85 }]}
                  disabled={!c.applyOpen}
                >
                  <Text style={[styles.cardActionText, { color: c.applyOpen ? '#fff' : colors.textLight }]}>
                    {c.applyOpen ? '게스트 신청' : '신청 마감'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/guest-chat?clubId=${c.clubId}` as any)}
                  style={({ pressed }) => [styles.cardActionBtn, { backgroundColor: colors.background }, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.primary} />
                  <Text style={[styles.cardActionText, { color: colors.primary }]}>문의</Text>
                </Pressable>
              </View>
            </Pressable>
            ));
          })()
        )}
        <Text style={[styles.note, { color: colors.textLight }]}>* 공개로 설정한 모임만 보여요. 모임 가입은 초대코드로만 가능해요.</Text>
      </ScrollView>
      )}
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
  cardTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
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
  viewToggle: { flexDirection: 'row', borderRadius: 999, padding: 3, gap: 2 },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999 },
  viewToggleText: { fontSize: 12, fontWeight: '800' },
  mapEmptyOverlay: { position: 'absolute', top: spacing.lg, alignSelf: 'center', borderRadius: 999, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  mapEmptyText: { ...typography.caption, fontWeight: '700' },
  sheet: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, borderRadius: 20, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.sm, maxWidth: 560, marginHorizontal: 'auto' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sheetTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1 },
  sheetType: { fontSize: 12, fontWeight: '600' },
  sheetSub: { fontSize: 13, marginTop: 3 },
  sheetClose: { padding: 4 },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.sm },
  infoLabel: { fontSize: 13, fontWeight: '600', width: 52 },
  infoValue: { fontSize: 13.5, fontWeight: '600', flex: 1, lineHeight: 19 },
  sheetSection: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: spacing.sm },
  sheetCoach: { flexDirection: 'row', gap: spacing.md, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  sheetCoachAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sheetCoachAvatarText: { fontSize: 15, fontWeight: '700' },
  sheetCoachName: { fontSize: 14.5, fontWeight: '700' },
  sheetCoachFee: { fontSize: 13.5, fontWeight: '700' },
  sheetCoachIntro: { fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  sheetCoachTime: { fontSize: 12, marginTop: 3 },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  sheetBtnPrimary: { flex: 1.4, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  sheetBtnPrimaryText: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  sheetBtnGhost: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  sheetBtnGhostText: { fontSize: 14.5, fontWeight: '700' },
  typeText: { fontSize: 12, fontWeight: '600' },
  coachBox: { borderRadius: 12, padding: spacing.md, gap: 6, marginTop: spacing.sm },
  coachBoxLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coachAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  coachAvatarText: { fontSize: 14, fontWeight: '700' },
  coachRowName: { fontSize: 13.5, fontWeight: '700' },
  coachRowFee: { fontSize: 13, fontWeight: '700' },
  coachRowIntro: { fontSize: 12, marginTop: 1 },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cardActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderRadius: 12 },
  cardActionText: { fontSize: 13.5, fontWeight: '700' },
  applyTag: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  applyTagText: { fontSize: 11, fontWeight: '800' },
  note: { ...typography.caption, marginTop: spacing.sm, lineHeight: 16 },
  regionChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  regionChipText: { ...typography.body2, fontWeight: '800' },
});
