import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Image, TextInput, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { CoachList } from '../../components/market/CoachList';
import { ComingSoon } from '../../components/market/ComingSoon';
import { COACH_MARKET_ENABLED } from '../../constants/features';
import { coachJobApi, type JobPostCard, AUDIENCE_LABEL, EMPLOYMENT_LABEL, ddayLabel } from '../../services/coachJob';
import { coachChatApi, coachApi } from '../../services/coach';
import { absolutizeUploadUrl } from '../../services/upload';
import { FilterSheet, EMPTY_FILTER, countFilters, type MarketFilter } from '../../components/market/FilterSheet';
import { BottomSheet } from '../../components/shared/BottomSheet';

// ─────────────────────────────────────────────────────────────
// 코치 허브(하단 탭 "코치") — 코치 구인·구직.
//  [구인 공고] 클럽·개인이 올린 코치 채용 공고 피드
//  [코치 찾기] 등록 코치 탐색(CoachList)
// 신뢰 톤: 언더라인 탭 · 회색 위계 · 색은 CTA/상태에만 · 필터는 시트.
// ─────────────────────────────────────────────────────────────

const SORTS = [
  { key: 'latest', label: '최신순' },
  { key: 'pay', label: '급여순' },
  { key: 'deadline', label: '마감임박순' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function CoachHub() {
  // 프로덕션 오픈 전 — 탭은 유지하되 내용은 "준비 중" 티저.
  if (!COACH_MARKET_ENABLED) return <ComingSoon />;
  return <CoachHubInner />;
}

function CoachHubInner() {
  const { colors } = useTheme();
  const router = useRouter();

  const [tab, setTab] = useState<'jobs' | 'coaches'>('jobs');
  const [filter, setFilter] = useState<MarketFilter>(EMPTY_FILTER);
  const [showFilter, setShowFilter] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('latest');
  const [showSort, setShowSort] = useState(false);
  const [jobs, setJobs] = useState<JobPostCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [myJobCount, setMyJobCount] = useState(0);
  const [myAppCount, setMyAppCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [inviteCount, setInviteCount] = useState(0);
  // 역할 기반 기본 탭은 최초 1회만 — 사용자가 탭을 만지면 유지.
  const tabTouched = useRef(false);
  const defaultApplied = useRef(false);

  const load = useCallback(async () => {
    try {
      setJobs(await coachJobApi.list({ regions: filter.regions, q: q.trim() || undefined, sort }));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // 내 활동 카운트는 실패해도 화면엔 지장 없음.
    coachJobApi.mine().then((r) => setMyJobCount(r.length)).catch(() => {});
    coachJobApi.applied().then((r) => setMyAppCount(r.length)).catch(() => {});
    coachChatApi.unreadCount().then(setChatUnread).catch(() => {});
    coachApi.me().then((p) => {
      const isCoach = !!p;
      setHasProfile(isCoach);
      // 코치는 '구인 공고'(지원할 것), 그 외엔 '코치 찾기'(모집할 것)가 첫 화면.
      if (!defaultApplied.current && !tabTouched.current) {
        defaultApplied.current = true;
        setTab(isCoach ? 'jobs' : 'coaches');
      }
      if (isCoach) {
        coachJobApi.invites()
          .then((r) => setInviteCount(r.filter((i) => i.status === 'SENT' && !i.applied).length))
          .catch(() => {});
      }
    }).catch(() => {});
  }, [filter.regions, q, sort]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 검색어 디바운스 — 타이핑 멈추면 350ms 뒤 재조회(useFocusEffect 는 q 변경만으로 재실행 안 됨).
  const qFirst = useRef(true);
  useEffect(() => {
    if (qFirst.current) { qFirst.current = false; return; }
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filter.regions]);

  // 카드 하트 토글(옵티미스틱).
  const toggleBookmark = (j: JobPostCard) => {
    setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, bookmarked: !j.bookmarked } : x)));
    coachJobApi.setBookmark(j.id, !j.bookmarked).catch(() => {
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, bookmarked: j.bookmarked } : x)));
    });
  };

  const myBadge = chatUnread;
  const filterCount = countFilters(filter, false);
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? '최신순';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 언더라인 탭 + MY */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        {([
          { key: 'jobs', label: '구인 공고' },
          { key: 'coaches', label: '코치 찾기' },
        ] as const).map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => { tabTouched.current = true; setTab(t.key); }}
              style={[styles.tabItem, on && { borderBottomColor: colors.text }]}
            >
              <Text style={[styles.tabText, { color: on ? colors.text : colors.textLight, fontWeight: on ? '700' : '500' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {tab === 'jobs' && !hasProfile && (
          <Pressable onPress={() => router.push('/market/job/new' as never)} hitSlop={6} style={styles.topAction}>
            <Text style={[styles.topActionText, { color: colors.primary }]}>공고 올리기</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/market/my' as never)} hitSlop={6} style={styles.topAction}>
          <Text style={[styles.topActionText, { color: colors.textSecondary }]}>MY</Text>
          {myBadge > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.danger }]}>
              <Text style={styles.badgeText}>{myBadge}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* 역할 배너 — 비코치: 코치 온보딩 / 코치: 받은 제안 */}
      {hasProfile === false && (
        <Pressable
          onPress={() => router.push('/coach/resume' as never)}
          style={({ pressed }) => [styles.roleBanner, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="person-add-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.roleBannerText, { color: colors.textSecondary }]}>코치로 활동 중이신가요? 프로필 하나로 공고 지원까지 시작할 수 있어요</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textLight} />
        </Pressable>
      )}
      {hasProfile === true && inviteCount > 0 && (
        <Pressable
          onPress={() => router.push('/market/invites' as never)}
          style={({ pressed }) => [styles.roleBanner, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="mail-unread-outline" size={15} color={colors.primary} />
          <Text style={[styles.roleBannerText, { color: colors.text }]}>
            함께하자는 제안이 <Text style={{ color: colors.primary, fontWeight: '700' }}>{inviteCount}건</Text> 와 있어요
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textLight} />
        </Pressable>
      )}

      {/* 검색 · 필터 · 정렬 — 공고 피드 */}
      {tab === 'jobs' && (
        <View style={styles.searchRow}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={15} color={colors.textLight} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={q}
              onChangeText={setQ}
              placeholder="공고 검색"
              placeholderTextColor={colors.textLight}
              returnKeyType="search"
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={colors.textLight} />
              </Pressable>
            )}
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
          <Pressable onPress={() => setShowSort(true)} style={styles.sortBtn} hitSlop={6}>
            <Text style={[styles.sortBtnText, { color: colors.textSecondary }]}>{sortLabel}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {tab === 'coaches' ? (
        <CoachList bottomPad={80} />
      ) : loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {jobs.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="megaphone-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {q.trim() || filterCount > 0 ? '조건에 맞는 공고가 없어요' : '아직 올라온 공고가 없어요'}
              </Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                코치가 필요하면 첫 공고를 올려보세요{'\n'}클럽 명의로도, 개인 요청으로도 가능해요
              </Text>
              <Pressable onPress={() => router.push('/market/job/new' as never)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.emptyBtnText}>공고 올리기</Text>
              </Pressable>
            </View>
          ) : (
            jobs.map((j) => {
              const dd = ddayLabel(j.deadline);
              const metaParts = [
                j.region,
                j.scheduleLabel,
                j.targetAudience ? AUDIENCE_LABEL[j.targetAudience] ?? j.targetAudience : null,
                j.employmentType ? EMPLOYMENT_LABEL[j.employmentType] ?? j.employmentType : null,
              ].filter(Boolean);
              return (
                <Pressable
                  key={j.id}
                  onPress={() => router.push(`/market/job/${j.id}` as never)}
                  style={({ pressed }) => [styles.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.92 }]}
                >
                  <View style={styles.jobHead}>
                    <Text style={[styles.jobOwner, { color: colors.textSecondary }]} numberOfLines={1}>
                      {j.clubName ?? '개인 요청'}
                    </Text>
                    {dd && (
                      <>
                        <Text style={[styles.headDot, { color: colors.textLight }]}>·</Text>
                        <Text style={[styles.jobOwner, { color: dd.urgent ? colors.danger : colors.textSecondary, fontWeight: dd.urgent ? '700' : '500' }]}>
                          {dd.label}
                        </Text>
                      </>
                    )}
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.time, { color: colors.textLight }]}>{relTime(j.createdAt)}</Text>
                    <Pressable onPress={() => toggleBookmark(j)} hitSlop={10}>
                      <Ionicons name={j.bookmarked ? 'heart' : 'heart-outline'} size={18} color={j.bookmarked ? colors.danger : colors.textLight} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.jobTitle, { color: colors.text }]} numberOfLines={2}>{j.title}</Text>
                    </View>
                    {!!j.thumbnail && (
                      <Image source={{ uri: absolutizeUploadUrl(j.thumbnail)! }} style={styles.jobThumb} />
                    )}
                  </View>
                  <Text style={[styles.jobMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {metaParts.join(' · ')}
                  </Text>
                  <View style={[styles.jobFootRow, { borderTopColor: colors.divider }]}>
                    <Text style={[styles.pay, { color: colors.text }, typography.tabular]}>{j.payLabel}</Text>
                    <Text style={[styles.footMeta, { color: colors.textLight }]}>
                      조회 {j.views} · 지원 {j.applicants}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      {/* 필터 시트 — 공고 피드는 지역만 */}
      <FilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        value={filter}
        onApply={setFilter}
        showCoachFilters={false}
      />

      {/* 정렬 시트 */}
      <BottomSheet visible={showSort} onClose={() => setShowSort(false)} title="정렬" maxHeight={40}>
        {SORTS.map((s) => {
          const on = sort === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => { setSort(s.key); setShowSort(false); }}
              style={[styles.sortRow, { borderBottomColor: colors.divider }]}
            >
              <Text style={[styles.sortRowText, { color: on ? colors.primary : colors.text, fontWeight: on ? '700' : '400' }]}>{s.label}</Text>
              {on && <Ionicons name="checkmark" size={18} color={colors.primary} />}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  tabItem: { paddingVertical: 13, marginRight: spacing.xl, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 15 },
  topAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, marginLeft: spacing.lg },
  topActionText: { fontSize: 14, fontWeight: '600' },
  badge: { minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  roleBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 11 },
  roleBannerText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'web' ? 9 : 8 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '400', padding: 0 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 9 },
  filterBtnText: { fontSize: 13, fontWeight: '600' },
  filterCount: { minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  filterCountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 9, paddingLeft: 2 },
  sortBtnText: { fontSize: 13, fontWeight: '500' },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth },
  sortRowText: { fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 10 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  jobCard: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  jobOwner: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  headDot: { fontSize: 12 },
  time: { fontSize: 12, fontWeight: '400', marginRight: 2 },
  jobTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, marginTop: spacing.sm, lineHeight: 24 },
  jobThumb: { width: 56, height: 56, borderRadius: 8, marginTop: spacing.sm },
  jobMeta: { fontSize: 13, fontWeight: '400', marginTop: 6 },
  jobFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  pay: { fontSize: 16, fontWeight: '700' },
  footMeta: { fontSize: 12, fontWeight: '400' },
});
