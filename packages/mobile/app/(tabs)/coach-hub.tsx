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
import { REGIONS } from '../../constants/regions';

// ─────────────────────────────────────────────────────────────
// 코치 허브(하단 탭 "코치") — 코치 구인·구직.
//  [구인 공고] 클럽·개인이 올린 코치 채용 공고 피드(원티드식 지원으로 이어짐)
//  [코치 찾기] 등록 코치 탐색(기존 목록 재사용)
//  상단 내 활동 바: 내 공고 · 내 지원 · 문의함(미읽음) · 내 이력서
// ─────────────────────────────────────────────────────────────

const SORTS = [
  { key: 'latest', label: '최신순' },
  { key: 'pay', label: '급여순' },
  { key: 'deadline', label: '마감임박' },
] as const;

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
  const { colors, shadows } = useTheme();
  const router = useRouter();

  const [tab, setTab] = useState<'jobs' | 'coaches'>('jobs');
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'latest' | 'pay' | 'deadline'>('latest');
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
      setJobs(await coachJobApi.list({ regions: regionFilter, q: q.trim() || undefined, sort }));
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
  }, [regionFilter, q, sort]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 검색어 디바운스 — 타이핑 멈추면 350ms 뒤 재조회(useFocusEffect 는 q 변경만으로 재실행 안 됨).
  const qFirst = useRef(true);
  useEffect(() => {
    if (qFirst.current) { qFirst.current = false; return; }
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, regionFilter]);

  // 카드 하트 토글(옵티미스틱).
  const toggleBookmark = (j: JobPostCard) => {
    setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, bookmarked: !j.bookmarked } : x)));
    coachJobApi.setBookmark(j.id, !j.bookmarked).catch(() => {
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, bookmarked: j.bookmarked } : x)));
    });
  };

  // MY 뱃지 — 신규 지원(채용)·미읽음(채팅) 합산.
  const myBadge = chatUnread;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 세그먼트 + MY(원티드처럼 탐색/MY 분리) */}
      <View style={[styles.segmentRow, { paddingTop: spacing.md }]}>
        <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {([
            { key: 'jobs', label: '구인 공고' },
            { key: 'coaches', label: '코치 찾기' },
          ] as const).map((t) => {
            const on = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => { tabTouched.current = true; setTab(t.key); }} style={[styles.segmentBtn, on && { backgroundColor: colors.primary }]}>
                <Text style={[styles.segmentText, { color: on ? '#fff' : colors.textSecondary }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {tab === 'jobs' && !hasProfile && (
          <Pressable
            onPress={() => router.push('/market/job/new' as never)}
            style={({ pressed }) => [styles.newBtn, { backgroundColor: colors.primary }, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.newBtnText}>공고 올리기</Text>
          </Pressable>
        )}
        {tab === 'jobs' && hasProfile && myAppCount > 0 && (
          <Pressable
            onPress={() => router.push('/market/applications' as never)}
            style={({ pressed }) => [styles.newBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.85 }]}
          >
            <Text style={[styles.newBtnText, { color: colors.text }]}>내 지원 {myAppCount}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => router.push('/market/my' as never)}
          style={({ pressed }) => [styles.myBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="person-circle-outline" size={17} color={colors.textSecondary} />
          <Text style={[styles.myBtnText, { color: colors.text }]}>MY</Text>
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
          style={({ pressed }) => [styles.roleBanner, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '35' }, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.roleBannerText, { color: colors.primary }]}>🏸 코치로 활동하시나요? 프로필 하나로 공고 지원까지 시작해 보세요</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.primary} />
        </Pressable>
      )}
      {hasProfile === true && inviteCount > 0 && (
        <Pressable
          onPress={() => router.push('/market/invites' as never)}
          style={({ pressed }) => [styles.roleBanner, { backgroundColor: colors.warning + '12', borderColor: colors.warning + '45' }, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.roleBannerText, { color: colors.warning }]}>🤝 함께하자는 제안이 {inviteCount}건 와 있어요</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.warning} />
        </Pressable>
      )}

      {/* 지역 필터(시/도 복수 선택) — 공고 피드 */}
      {tab === 'jobs' && (
        <View style={styles.regionBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.lg }}>
            <Pressable
              onPress={() => setRegionFilter([])}
              style={[styles.regionChip, { backgroundColor: regionFilter.length === 0 ? colors.text : colors.surface, borderColor: regionFilter.length === 0 ? colors.text : colors.border }]}
            >
              <Text style={[styles.regionChipText, { color: regionFilter.length === 0 ? '#fff' : colors.textSecondary }]}>전국</Text>
            </Pressable>
            {REGIONS.map((r) => {
              const on = regionFilter.includes(r);
              return (
                <Pressable
                  key={r}
                  onPress={() => setRegionFilter((prev) => (on ? prev.filter((x) => x !== r) : [...prev, r]))}
                  style={[styles.regionChip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
                >
                  <Text style={[styles.regionChipText, { color: on ? '#fff' : colors.textSecondary }]}>{r}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 검색 + 정렬 — 공고 피드 */}
      {tab === 'jobs' && (
        <View style={styles.searchRow}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={15} color={colors.textLight} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={q}
              onChangeText={setQ}
              placeholder="공고 검색 (제목·지역·내용)"
              placeholderTextColor={colors.textLight}
              returnKeyType="search"
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={colors.textLight} />
              </Pressable>
            )}
          </View>
          {SORTS.map((so) => {
            const on = sort === so.key;
            return (
              <Pressable key={so.key} onPress={() => setSort(so.key)} style={[styles.sortChip, { backgroundColor: on ? colors.text : colors.surface, borderColor: on ? colors.text : colors.border }]}>
                <Text style={[styles.sortChipText, { color: on ? '#fff' : colors.textSecondary }]}>{so.label}</Text>
              </Pressable>
            );
          })}
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
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 올라온 공고가 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>
                코치가 필요하면 첫 공고를 올려보세요{'\n'}클럽 명의로도, 개인 요청으로도 가능해요
              </Text>
              <Pressable onPress={() => router.push('/market/job/new' as never)} style={[styles.emptyBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.emptyBtnText}>공고 올리기</Text>
              </Pressable>
            </View>
          ) : (
            jobs.map((j) => (
              <Pressable
                key={j.id}
                onPress={() => router.push(`/market/job/${j.id}` as never)}
                style={({ pressed }) => [styles.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm, pressed && { opacity: 0.92 }]}
              >
                <View style={styles.jobHead}>
                  <View style={[styles.ownerBadge, { backgroundColor: j.clubName ? colors.primary + '14' : colors.info + '18' }]}>
                    <Text style={[styles.ownerBadgeText, { color: j.clubName ? colors.primary : colors.info }]}>
                      {j.clubName ?? '개인 요청'}
                    </Text>
                  </View>
                  {(() => {
                    const dd = ddayLabel(j.deadline);
                    if (!dd) return null;
                    return (
                      <View style={[styles.ownerBadge, { backgroundColor: dd.urgent ? colors.danger + '15' : colors.background }]}>
                        <Text style={[styles.ownerBadgeText, { color: dd.urgent ? colors.danger : colors.textSecondary }]}>{dd.label}</Text>
                      </View>
                    );
                  })()}
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.time, { color: colors.textLight }]}>{relTime(j.createdAt)}</Text>
                  <Pressable onPress={() => toggleBookmark(j)} hitSlop={10}>
                    <Ionicons name={j.bookmarked ? 'heart' : 'heart-outline'} size={19} color={j.bookmarked ? colors.danger : colors.textLight} />
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
                <View style={styles.jobMetaRow}>
                  <Ionicons name="location-outline" size={13} color={colors.textLight} />
                  <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>{j.region}</Text>
                  <Text style={[styles.jobMetaDot, { color: colors.textLight }]}>·</Text>
                  <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>{j.scheduleLabel}</Text>
                  {!!j.targetAudience && (
                    <View style={[styles.tinyChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[styles.tinyChipText, { color: colors.textSecondary }]}>{AUDIENCE_LABEL[j.targetAudience] ?? j.targetAudience}</Text>
                    </View>
                  )}
                  {!!j.employmentType && (
                    <View style={[styles.tinyChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Text style={[styles.tinyChipText, { color: colors.textSecondary }]}>{EMPLOYMENT_LABEL[j.employmentType] ?? j.employmentType}</Text>
                    </View>
                  )}
                </View>
                <View style={[styles.jobFootRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.pay, { color: colors.text }]}>{j.payLabel}</Text>
                  <View style={styles.footRight}>
                    <Text style={[styles.viewsText, { color: colors.textLight }]}>조회 {j.views}</Text>
                    <View style={[styles.applicantChip, { backgroundColor: j.applicants > 0 ? colors.primary + '12' : colors.background }]}>
                      <Text style={[styles.applicants, { color: j.applicants > 0 ? colors.primary : colors.textLight }]}>
                        지원 {j.applicants}명
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  roleBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 10 },
  roleBannerText: { flex: 1, fontSize: 12.5, fontWeight: '800', lineHeight: 17 },
  myBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 9 },
  regionBar: { paddingBottom: spacing.sm },
  regionChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  regionChipText: { fontSize: 12.5, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'web' ? 8 : 7 },
  searchInput: { flex: 1, fontSize: 13, fontWeight: '600', padding: 0 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  sortChipText: { fontSize: 12, fontWeight: '800' },
  tinyChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, marginLeft: 2 },
  tinyChipText: { fontSize: 10.5, fontWeight: '800' },
  footRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  viewsText: { fontSize: 11.5, fontWeight: '700' },
  myBtnText: { fontSize: 13, fontWeight: '800' },
  badge: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  segmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  segment: { flex: 1, flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 13.5, fontWeight: '800' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: 12 },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  jobCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ownerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  ownerBadgeText: { fontSize: 11, fontWeight: '800' },
  time: { ...typography.caption },
  jobTitle: { fontSize: 17.5, fontWeight: '800', letterSpacing: -0.3, marginTop: spacing.sm, lineHeight: 24 },
  jobThumb: { width: 64, height: 64, borderRadius: 12, marginTop: spacing.sm },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  jobMeta: { fontSize: 13, fontWeight: '600' },
  jobMetaDot: { fontSize: 12 },
  jobFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  pay: { fontSize: 15.5, fontWeight: '900' },
  applicantChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  applicants: { fontSize: 12.5, fontWeight: '800' },
});
