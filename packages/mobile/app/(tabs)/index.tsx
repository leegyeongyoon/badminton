import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useClubStore } from '../../store/clubStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useTurnStore } from '../../store/turnStore';
import { clubSessionApi } from '../../services/clubSession';
import { profileApi, MyStatusResponse } from '../../services/profile';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Tag } from '../../components/ui/Tag';
import { COACH_MARKET_ENABLED } from '../../constants/features';
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { ClubModal } from '../../components/settings/ClubModal';

// ─────────────────────────────────────────────────────────────
// 홈 — "오늘 정모" 중심 대시보드 (신뢰 톤).
//  1) 헤더: 이름 + 급수 태그 + 알림
//  2) 내 차례 히어로(게임 배정 시)
//  3) 오늘 정모: 진행 중 정모 카드(내 상태 + 맥락 CTA)
//  4) 내 모임: 간결한 리스트 행
//  5) 바로가기: 텍스트 행
// 데이터 배선(소켓 리프레시·체크인 정책)은 기존 그대로 — 렌더만 재구성.
// ─────────────────────────────────────────────────────────────

interface ActiveSession {
  id: string;
  clubId: string;
  clubName: string;
  facilityId: string;
  facilityName: string;
  status: string;
  startedAt: string;
  // optional richer fields (server may add these later)
  title?: string;
  scheduledStartAt?: string;
}

// 정모 날짜 "오늘 정모 6/19" — 모임(클럽)과 정모(일자)를 한눈에 구분하기 위함.
// web-safe (Date만 사용). 오늘이면 "오늘", 어제면 "어제", 그 외 "M/D".
function formatSessionDateLabel(iso?: string): string {
  if (!iso) return '정모';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '정모';
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86400000;
  const diff = Math.round((startOf(now) - startOf(d)) / dayMs);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (diff === 0) return `오늘 정모 ${md}`;
  if (diff === 1) return `어제 정모 ${md}`;
  return `정모 ${md}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuthStore();
  const { clubs, fetchClubs } = useClubStore();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const { myTurns, fetchMyTurns } = useTurnStore();

  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [skillLevel, setSkillLevel] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<MyStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Club create / join modals (reuse the existing entry from 더보기)
  const [showCreate, setShowCreate] = useState(false);
  const [newClubType, setNewClubType] = useState<'CLUB' | 'MEETUP'>('CLUB');
  const [showJoin, setShowJoin] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const { createClub, joinClub } = useClubStore();

  // Global user room is already joined by the tab layout, but join here too
  // so this screen reliably gets turn pushes even if mounted first.
  useUserRoom(user?.id);

  const loadActiveSessions = useCallback(async (clubList: { id: string }[]) => {
    if (clubList.length === 0) {
      setActiveSessions([]);
      return;
    }
    const results = await Promise.all(
      clubList.map((c) =>
        clubSessionApi
          .getActive(c.id)
          .then((r) => r.data as ActiveSession | null)
          .catch(() => null),
      ),
    );
    setActiveSessions(results.filter((s): s is ActiveSession => !!s && s.status === 'ACTIVE'));
  }, []);

  const loadMyStatus = useCallback(async () => {
    try {
      const { data } = await profileApi.getMyStatus();
      setMyStatus(data ?? null);
    } catch {
      setMyStatus(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([fetchStatus(), fetchMyTurns(), loadProfile(), loadMyStatus()]);
      await fetchClubs();
      // fetchClubs updates the store; read the latest list from the store
      const latestClubs = useClubStore.getState().clubs;
      await loadActiveSessions(latestClubs);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchMyTurns, fetchClubs, loadActiveSessions, loadMyStatus]);

  // 자가 체크인 제거: 출석은 정모 QR 스캔(→ /attend)으로만. 홈에는 체크인 버튼 없음.

  // 자동 체크인 제거: 홈을 '열기만 해도' 활성 정모에 자동 출석되던 동작은, 오늘 안 오는
  // 사람까지 정모 풀에 잡혀 혼란을 줘서 제거했다. 출석은 현장 QR 스캔 또는 위 '체크인'
  // 버튼(handleQuickCheckin)으로만 이뤄진다.

  const loadProfile = async () => {
    try {
      const { data } = await profileApi.getProfile();
      setSkillLevel(data?.skillLevel ?? null);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  // ─── Real-time refresh: a 정모 goes active/ends, or you get assigned ───
  const handleRealtime = useCallback(() => {
    fetchMyTurns();
    fetchStatus();
    loadMyStatus();
    loadActiveSessions(useClubStore.getState().clubs);
  }, [fetchMyTurns, fetchStatus, loadMyStatus, loadActiveSessions]);
  useSocketEvent('clubSession:started', handleRealtime);
  useSocketEvent('clubSession:ended', handleRealtime);
  useSocketEvent('turn:started', handleRealtime);
  useSocketEvent('turn:completed', handleRealtime);
  useSocketEvent('turn:promoted', handleRealtime);
  useSocketEvent('gameBoard:entryPushed', handleRealtime);
  useSocketEvent('gameBoard:entryAdded', handleRealtime);
  useSocketEvent('gameBoard:entryRemoved', handleRealtime);

  // ─── Derived ───
  const playingTurn = useMemo(
    () => myTurns.find((t) => t.status === 'PLAYING'),
    [myTurns],
  );

  // Club id -> leader/staff?  (clubStore maps role + isLeader)
  const staffClubIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of clubs as any[]) {
      if (c.role === 'LEADER' || c.role === 'STAFF' || c.isLeader) set.add(c.id);
    }
    return set;
  }, [clubs]);

  // Checked in to THIS 정모? Status carries facilityId (and sometimes clubSessionId).
  const isCheckedInToSession = useCallback(
    (s: ActiveSession) => {
      if (!checkinStatus) return false;
      if (checkinStatus.clubSessionId) return checkinStatus.clubSessionId === s.id;
      return checkinStatus.facilityId === s.facilityId;
    },
    [checkinStatus],
  );

  const greetingName = user?.name || '회원';

  // Only operators may create a 모임 (운영자만 모임 생성). A PLAYER sees a short
  // hint linking to 운영자 신청 (더보기) instead of the create button.
  const canCreateClub = user?.role === 'SUPER_ADMIN' || user?.role === 'CLUB_LEADER';

  // 정모가 없을 때 운영진에게 보여줄 "정모 시작" 진입점 — 첫 운영 모임.
  const firstStaffClub = useMemo(
    () => (clubs as any[]).find((c) => staffClubIds.has(c.id)) ?? null,
    [clubs, staffClubIds],
  );

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenContainer>
          <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <SkeletonGroup>
                <Skeleton width={140} height={22} borderRadius={radius.sm} />
              </SkeletonGroup>
            </View>
            <View style={{ height: spacing.xl }} />
            <Skeleton width="100%" height={140} borderRadius={12} />
            <View style={{ height: spacing.lg }} />
            <Skeleton width="100%" height={120} borderRadius={12} />
          </ScrollView>
        </ScreenContainer>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContainer>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        // Android(Fabric)는 RefreshControl이 스크롤 높이를 0으로 붕괴 → 백지. iOS만 붙임.
        refreshControl={Platform.OS === 'ios' ? <AnimatedRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {/* ─── 1. 헤더 — 이름·급수·알림 ─── */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {greetingName}님
          </Text>
          {!!skillLevel && <Tag label={`${skillLevel}조`} />}
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.push('/notifications')} hitSlop={8}>
            <Icon name="notification" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* ─── 2. 내 차례 히어로 ─── */}
        {playingTurn && (
          <Pressable
            onPress={() => router.push('/(tabs)/my-status')}
            style={({ pressed }) => [
              styles.heroCard,
              { backgroundColor: colors.secondary },
              pressed && { opacity: 0.94 },
            ]}
          >
            <View style={styles.heroBadge}>
              <View style={styles.heroLiveDot} />
              <Text style={styles.heroBadgeText}>지금 내 차례</Text>
            </View>
            <Text style={styles.heroTitle}>{playingTurn.courtName} · 게임 시작</Text>
            <Text style={styles.heroSub}>지금 바로 코트로 가세요. 탭하면 게임 화면이 열려요.</Text>
          </Pressable>
        )}

        {/* ─── 3. 오늘 정모 ─── */}
        {clubs.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>오늘 정모</Text>
            {activeSessions.length === 0 ? (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.emptySessionText, { color: colors.textSecondary }]}>
                  지금 진행 중인 정모가 없어요
                </Text>
                {firstStaffClub && (
                  <Pressable onPress={() => router.push(`/club/${firstStaffClub.id}`)} hitSlop={6} style={{ marginTop: 6 }}>
                    <Text style={[styles.linkText, { color: colors.primary }]}>정모 시작하러 가기</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              activeSessions.map((session) => {
                const isStaff = staffClubIds.has(session.clubId);
                const checkedIn = isCheckedInToSession(session);
                const mine = myStatus && myStatus.clubSessionId === session.id ? myStatus : null;
                const isPlaying = mine?.status === 'PLAYING';
                const isQueued = mine?.status === 'QUEUED';

                let mineLabel: string;
                let mineTint: string;
                if (isPlaying) {
                  mineLabel = mine?.courtName ? `게임 중 · ${mine.courtName}` : '게임 중';
                  mineTint = colors.danger;
                } else if (isQueued) {
                  mineLabel = mine?.queueOrder && mine.queueOrder > 0 ? `대기 ${mine.queueOrder}번째` : '다음 게임 대기';
                  mineTint = colors.primary;
                } else if (checkedIn) {
                  mineLabel = '참석 중';
                  mineTint = colors.secondary;
                } else {
                  mineLabel = '미체크인';
                  mineTint = colors.textSecondary;
                }
                const dateLabel = session.title || formatSessionDateLabel(session.scheduledStartAt || session.startedAt);

                return (
                  <View key={session.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.sessionHead}>
                      <View style={[styles.liveDot, { backgroundColor: colors.secondary }]} />
                      <Text style={[styles.sessionClub, { color: colors.text }]} numberOfLines={1}>{session.clubName}</Text>
                      <Text style={[styles.sessionMeta, { color: colors.textLight }]}>진행 중</Text>
                    </View>
                    <Text style={[styles.sessionSub, { color: colors.textSecondary }]} numberOfLines={1}>
                      {dateLabel} · {session.facilityName}
                    </Text>
                    <Text style={[styles.mineState, { color: mineTint }]}>{mineLabel}</Text>

                    <View style={styles.sessionActions}>
                      {isStaff ? (
                        <>
                          <Button title="운영판" icon="board" variant="primary" size="md" onPress={() => router.push(`/session/${session.id}/operate`)} style={{ flex: 1 }} />
                          <Button title="현황 보기" icon="tv" variant="ghost" size="md" onPress={() => router.push(`/session/${session.id}/board`)} style={{ flex: 1, backgroundColor: colors.surface2 }} />
                        </>
                      ) : !checkedIn ? (
                        <>
                          <Button title="QR 체크인" icon="checkin" variant="primary" size="md" onPress={() => router.push('/checkin-modal')} style={{ flex: 1 }} />
                          <Button title="현황 보기" icon="tv" variant="ghost" size="md" onPress={() => router.push(`/session/${session.id}/board`)} style={{ flex: 1, backgroundColor: colors.surface2 }} />
                        </>
                      ) : (
                        <Button title="현황 보기" icon="tv" variant="primary" size="md" fullWidth onPress={() => router.push(`/session/${session.id}/board`)} style={{ flex: 1 }} />
                      )}
                    </View>
                    {isStaff && !checkedIn && (
                      // 운영진도 게임에 참석 가능 — 미체크인이면 앱 내 QR 스캔으로 출석.
                      <Pressable onPress={() => router.push('/checkin-modal')} hitSlop={6} style={{ marginTop: spacing.md, alignSelf: 'center' }}>
                        <Text style={[styles.linkText, { color: colors.textSecondary }]}>아직 출석 전이에요 — QR 체크인</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ─── 4. 내 모임 — 리스트 행 ─── */}
        {clubs.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>내 모임</Text>
            <View style={[styles.card, styles.listCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(clubs as any[]).map((c, i) => {
                const isStaff = staffClubIds.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/club/${c.id}`)}
                    style={({ pressed }) => [
                      styles.clubRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <View style={[styles.clubAvatar, { backgroundColor: colors.surface2 }]}>
                      <Text style={[styles.clubAvatarLetter, { color: colors.textSecondary }]}>{c.name[0]}</Text>
                    </View>
                    <Text style={[styles.clubName, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                    {isStaff && <Tag label="운영진" variant="primary" />}
                    <View style={{ flex: 1 }} />
                    {c.memberCount != null && (
                      <Text style={[styles.clubMeta, { color: colors.textLight }]}>{c.memberCount}명</Text>
                    )}
                    <Icon name="chevronRight" size={15} color={colors.textLight} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* ─── 5. 바로가기 — 텍스트 행 ─── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>바로가기</Text>
          <View style={[styles.card, styles.listCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {[
              canCreateClub ? { icon: 'add' as const, label: '모임 만들기', onPress: () => setShowCreate(true) } : null,
              { icon: 'link' as const, label: '초대코드로 참여', onPress: () => setShowJoin(true) },
              { icon: 'search' as const, label: '모임 찾기', onPress: () => router.push('/discover') },
              COACH_MARKET_ENABLED ? { icon: 'whistle' as const, label: '코치 구인·구직', onPress: () => router.push('/(tabs)/coach-hub' as never) } : null,
            ].filter(Boolean).map((item, i) => (
              <Pressable
                key={item!.label}
                onPress={item!.onPress}
                style={({ pressed }) => [
                  styles.quickRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Icon name={item!.icon} size={17} color={colors.textSecondary} />
                <Text style={[styles.quickLabel, { color: colors.text }]}>{item!.label}</Text>
                <View style={{ flex: 1 }} />
                <Icon name="chevronRight" size={15} color={colors.textLight} />
              </Pressable>
            ))}
          </View>
          {!canCreateClub && clubs.length > 0 && (
            <Pressable onPress={() => router.push('/(tabs)/more')} hitSlop={6}>
              <Text style={[styles.operatorHint, { color: colors.textLight }]}>
                모임을 만들려면 <Text style={{ color: colors.primary, fontWeight: '600' }}>운영자 신청</Text>이 필요해요
              </Text>
            </Pressable>
          )}
        </View>

        {/* ─── 빈 상태 (모임 0) ─── */}
        {clubs.length === 0 && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="club"
              title="아직 참여한 모임이 없어요"
              description="모임에 참여하면 정모 일정과 체크인, 게임 배정을 한눈에 볼 수 있어요."
              action={{ label: '모임 참여하기', onPress: () => setShowJoin(true), icon: 'link' }}
              secondaryAction={
                canCreateClub
                  ? { label: '새 모임 만들기', onPress: () => setShowCreate(true) }
                  : { label: '모임 찾기', onPress: () => router.push('/discover') }
              }
            />
            {!canCreateClub && (
              <Pressable onPress={() => router.push('/(tabs)/more')} hitSlop={6}>
                <Text style={[styles.operatorHint, { color: colors.textLight }]}>
                  모임을 만들려면 <Text style={{ color: colors.primary, fontWeight: '600' }}>운영자 신청</Text>이 필요해요
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
      </ScreenContainer>

      {/* Club modals */}
      <ClubModal
        mode="create"
        visible={showCreate}
        value={clubName}
        onChangeText={setClubName}
        clubType={newClubType}
        onChangeClubType={setNewClubType}
        onConfirm={async () => {
          if (!clubName.trim()) return;
          try {
            await createClub(clubName.trim(), newClubType);
            setClubName('');
            setShowCreate(false);
            await loadAll();
          } catch {
            /* surfaced by store; keep modal open */
          }
        }}
        onCancel={() => {
          setShowCreate(false);
          setClubName('');
        }}
      />
      <ClubModal
        mode="join"
        visible={showJoin}
        value={inviteCode}
        onChangeText={setInviteCode}
        onConfirm={async () => {
          if (!inviteCode.trim()) return;
          try {
            await joinClub(inviteCode.trim());
            setInviteCode('');
            setShowJoin(false);
            await loadAll();
          } catch {
            /* surfaced by store; keep modal open */
          }
        }}
        onCancel={() => {
          setShowJoin(false);
          setInviteCode('');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxxl,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
    fontFamily: typography.h3.fontFamily,
  },

  // Hero (내 차례) — 긴급 기능이라 색 배경 유지, 굵기만 절제.
  heroCard: {
    borderRadius: 12,
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  heroLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  heroBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '400', marginTop: 4, lineHeight: 18 },

  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: spacing.sm, letterSpacing: -0.2 },

  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  listCard: { paddingVertical: 2, paddingHorizontal: spacing.lg },

  // 오늘 정모
  emptySessionText: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  linkText: { fontSize: 13, fontWeight: '600' },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  sessionClub: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  sessionMeta: { fontSize: 12, fontWeight: '500' },
  sessionSub: { fontSize: 13, fontWeight: '400', marginTop: 5 },
  mineState: { fontSize: 13, fontWeight: '600', marginTop: 3 },
  sessionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

  // 내 모임 행
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  clubAvatar: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  clubAvatarLetter: { fontSize: 15, fontWeight: '700' },
  clubName: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  clubMeta: { fontSize: 12, fontWeight: '400' },

  // 바로가기 행
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  quickLabel: { fontSize: 14, fontWeight: '500' },

  operatorHint: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  emptyWrap: { marginTop: spacing.xl, gap: spacing.md },
});
