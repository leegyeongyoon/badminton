import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useClubStore } from '../../store/clubStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useTurnStore } from '../../store/turnStore';
import { clubSessionApi } from '../../services/clubSession';
import { profileApi, MyStatusResponse } from '../../services/profile';
import { getItem, setItem } from '../../services/storage';
import { showSuccess } from '../../utils/feedback';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useTheme } from '../../hooks/useTheme';
import { getSkillMeta } from '../../constants/skill';
import { typography, spacing, radius, palette } from '../../constants/theme';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { ClubModal } from '../../components/settings/ClubModal';

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
  const { colors, shadows } = useTheme();
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

  const skillMeta = skillLevel ? getSkillMeta(skillLevel) : null;
  const greetingName = user?.name || '회원';

  // Only operators may create a 모임 (운영자만 모임 생성). A PLAYER sees a short
  // hint linking to 운영자 신청 (더보기) instead of the create button.
  const canCreateClub = user?.role === 'SUPER_ADMIN' || user?.role === 'CLUB_LEADER';

  // Page background: a soft neutral so white cards have definition by contrast
  // (Toss/당근 style structure) without leaning on drop-shadows.
  const pageBg = colors.surfaceSecondary;

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: pageBg }]}>
        <ScreenContainer>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.greetingRow}>
              <SkeletonGroup>
                <Skeleton width={160} height={28} borderRadius={radius.sm} />
                <Skeleton width={220} height={16} borderRadius={radius.sm} style={{ marginTop: spacing.sm }} />
              </SkeletonGroup>
            </View>
            <View style={{ height: spacing.xl }} />
            <Skeleton width="100%" height={150} borderRadius={radius.card} />
            <View style={{ height: spacing.lg }} />
            <Skeleton width="100%" height={130} borderRadius={radius.card} />
          </ScrollView>
        </ScreenContainer>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: pageBg }]}>
      <ScreenContainer>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={Platform.OS === 'web' ? undefined : <AnimatedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* ─── 1. Greeting ─── */}
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: colors.text }]} numberOfLines={1}>
              {greetingName}님 👋
            </Text>
            <Text style={[styles.greetingSub, { color: colors.textSecondary }]}>
              오늘도 즐거운 한 게임!
            </Text>
          </View>
          {skillMeta ? (
            <View style={[styles.skillBadge, { backgroundColor: skillMeta.color }]}>
              <Text style={styles.skillBadgeLevel}>{skillMeta.level}</Text>
              <Text style={styles.skillBadgeLabel} numberOfLines={1}>{skillMeta.description}</Text>
            </View>
          ) : null}
        </View>

        {/* ─── 2. 내 차례 hero ─── */}
        {playingTurn && (
          <Pressable
            onPress={() => router.push('/(tabs)/my-status')}
            style={({ pressed }) => [
              styles.heroCard,
              { backgroundColor: colors.secondary },
              shadows.sm,
              pressed && { opacity: 0.94 },
            ]}
          >
            <View style={styles.heroBadge}>
              <View style={styles.heroLiveDot} />
              <Text style={styles.heroBadgeText}>지금 내 차례</Text>
            </View>
            <Text style={styles.heroTitle}>{playingTurn.courtName} · 게임 시작</Text>
            <Text style={styles.heroSub}>
              지금 바로 코트로 가세요. 탭하면 게임 화면이 열려요.
            </Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>게임 보기</Text>
              <Icon name="chevronRight" size={18} color={palette.white} />
            </View>
          </Pressable>
        )}

        {/* ─── 3. 내 모임 (centerpiece) — ONE unified list ───
            모임마다 카드 하나. 각 카드가 그 모임의 "지금" 진행 상황(진행 중 정모 +
            내 상태)과 맥락에 맞는 단 하나의 primary 액션을 보여준다.
            운영판은 그 모임의 LEADER/STAFF에게만 노출(staffClubIds 게이트). */}
        {clubs.length > 0 && (
          <View style={styles.section}>
            {/* Section header: 내 모임 + count badge + quiet subtitle */}
            <View style={styles.sectionHead}>
              <View style={styles.sectionHeadRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>내 모임</Text>
                <View style={[styles.sectionCount, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.sectionCountText, { color: colors.primary }]}>{clubs.length}</Text>
                </View>
              </View>
              <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
                정모 진행 상황과 내 상태를 한눈에 확인하세요
              </Text>
            </View>
            {(clubs as any[]).map((c) => {
              const isStaff = staffClubIds.has(c.id);
              const session = activeSessions.find((s) => s.clubId === c.id) || null;
              const checkedIn = session ? isCheckedInToSession(session) : false;
              const mine = session && myStatus && myStatus.clubSessionId === session.id ? myStatus : null;
              const isPlaying = mine?.status === 'PLAYING';
              const isQueued = mine?.status === 'QUEUED';

              // 상태 한 줄: 진행 중 정모면 정모(일자)+내 상태, 없으면 calm.
              let stateTint = colors.textLight;
              let stateText = '진행 중인 정모 없음';
              let stateStrong = false;
              if (session) {
                const dateLabel = session.title || formatSessionDateLabel(session.scheduledStartAt || session.startedAt);
                let mineLabel: string;
                if (isPlaying) {
                  mineLabel = mine?.courtName ? `게임 중 · ${mine.courtName}` : '게임 중';
                  stateTint = colors.playerInTurn;
                } else if (isQueued) {
                  mineLabel = mine?.queueOrder && mine.queueOrder > 0 ? `대기 ${mine.queueOrder}번째` : '다음 게임 대기';
                  stateTint = colors.primary;
                } else if (checkedIn) {
                  mineLabel = '참석 중';
                  stateTint = colors.secondary;
                } else {
                  mineLabel = '미체크인';
                  stateTint = colors.warning;
                }
                stateText = `${dateLabel} · 진행 중 · ${mineLabel}`;
                stateStrong = true;
              }

              // 맥락별 단 하나의 primary 액션 (+ 조용한 secondary는 운영진 현황 보기뿐).
              // member→현황 보기 / member 미체크인→체크인 / operator→운영판
              //   / 정모 없는 operator→정모 시작 / 정모 없는 member→카드 탭(클럽).
              const goClub = () => router.push(`/club/${c.id}`);
              return (
                <Pressable
                  key={c.id}
                  onPress={goClub}
                  style={({ pressed }) => [
                    styles.clubCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    session && { borderColor: colors.secondaryLight, backgroundColor: colors.surface },
                    pressed && { opacity: 0.96 },
                  ]}
                >
                  {/* Header row: avatar + 모임 이름 + (운영진) 배지 */}
                  <View style={styles.clubTitleRow}>
                    <View style={[styles.clubIconWrap, { backgroundColor: session ? colors.secondaryLight : colors.primaryLight }]}>
                      <Icon name="club" size={20} color={session ? colors.secondary : colors.primary} />
                    </View>
                    <Text style={[styles.clubName, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {isStaff && (
                      <View style={[styles.rolePill, { backgroundColor: colors.warningLight }]}>
                        <Icon name="leader" size={11} color={colors.warning} />
                        <Text style={[styles.rolePillText, { color: colors.warning }]}>운영진</Text>
                      </View>
                    )}
                    {!session && !isStaff && <Icon name="chevronRight" size={18} color={colors.textLight} />}
                  </View>

                  {/* Status row: full-width 정모(일자) · 진행 중 · 내 상태  /  진행 중인 정모 없음 */}
                  <View style={styles.clubStatusRow}>
                    {stateStrong && <View style={[styles.statusDot, { backgroundColor: stateTint }]} />}
                    <Text
                      style={[
                        styles.clubStatusText,
                        { color: stateStrong ? stateTint : colors.textLight },
                        stateStrong && { fontWeight: '600' },
                      ]}
                      numberOfLines={1}
                    >
                      {stateText}
                    </Text>
                  </View>

                  {/* hairline divider — gives the action row structure without a shadow */}
                  {(session || isStaff) && <View style={[styles.clubDivider, { backgroundColor: colors.divider }]} />}

                  {/* ONE primary action by context (운영판 = 운영진만). */}
                  {session ? (
                    isStaff ? (
                      <View style={{ gap: spacing.sm + 2 }}>
                        <View style={styles.clubActions}>
                          <Button
                            title="운영판"
                            icon="board"
                            variant="primary"
                            size="md"
                            onPress={() => router.push(`/session/${session.id}/operate`)}
                            style={{ flex: 1 }}
                          />
                          <Button
                            title="현황 보기"
                            icon="tv"
                            variant="outline"
                            size="md"
                            onPress={() => router.push(`/session/${session.id}/board`)}
                            style={{ flex: 1 }}
                          />
                        </View>
                        {!checkedIn && (
                          // 운영진도 게임에 참석 가능 — 미체크인이면 앱 내 QR 스캔으로 출석.
                          <Button
                            title="QR 체크인"
                            icon="checkin"
                            variant="outline"
                            size="md"
                            fullWidth
                            onPress={() => router.push('/checkin-modal')}
                          />
                        )}
                      </View>
                    ) : !checkedIn ? (
                      // 회원 · 미체크인: 앱 내 카메라로 정모 QR을 스캔해 출석 + 현황 보기.
                      <View style={styles.clubActions}>
                        <Button
                          title="QR 체크인"
                          icon="checkin"
                          variant="primary"
                          size="md"
                          onPress={() => router.push('/checkin-modal')}
                          style={{ flex: 1 }}
                        />
                        <Button
                          title="현황 보기"
                          icon="tv"
                          variant="outline"
                          size="md"
                          onPress={() => router.push(`/session/${session.id}/board`)}
                          style={{ flex: 1 }}
                        />
                      </View>
                    ) : (
                      // 회원 · 체크인 완료: 현황 보기.
                      <Button
                        title="현황 보기"
                        icon="tv"
                        variant="primary"
                        size="md"
                        fullWidth
                        onPress={() => router.push(`/session/${session.id}/board`)}
                        style={styles.clubPrimaryBtn}
                      />
                    )
                  ) : (
                    isStaff && (
                      <Button
                        title="정모 시작"
                        icon="play"
                        variant="outline"
                        size="md"
                        fullWidth
                        onPress={goClub}
                        style={styles.clubPrimaryBtn}
                      />
                    )
                  )}
                </Pressable>
              );
            })}

            {/* Footer actions — anchored as a tidy section, not floating buttons. */}
            <View style={[styles.footerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.footerLabel, { color: colors.textSecondary }]}>
                다른 모임도 함께 운영해보세요
              </Text>
              <View style={styles.footerActions}>
                {canCreateClub && (
                  <Button
                    title="모임 만들기"
                    icon="add"
                    variant="outline"
                    size="md"
                    onPress={() => setShowCreate(true)}
                    style={{ flex: 1 }}
                  />
                )}
                <Button
                  title="모임 참여"
                  icon="link"
                  variant="ghost"
                  size="md"
                  onPress={() => setShowJoin(true)}
                  style={{ flex: 1 }}
                />
              </View>
              {!canCreateClub && (
                <Pressable onPress={() => router.push('/(tabs)/more')} hitSlop={6}>
                  <Text style={[styles.operatorHint, { color: colors.textLight }]}>
                    모임을 만들려면 <Text style={{ color: colors.primary, fontWeight: '700' }}>운영자 신청</Text>이 필요해요
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* ─── 4. Empty state (no clubs) ─── */}
        {clubs.length === 0 && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="club"
              title="아직 참여한 모임이 없어요"
              description="모임에 참여하면 정모 일정과 체크인, 게임 배정을 한눈에 볼 수 있어요."
              action={{ label: '모임 참여하기', onPress: () => setShowJoin(true), icon: 'link' }}
              {...(canCreateClub
                ? { secondaryAction: { label: '새 모임 만들기', onPress: () => setShowCreate(true) } }
                : {})}
            />
            {!canCreateClub && (
              <Pressable onPress={() => router.push('/(tabs)/more')} hitSlop={6}>
                <Text style={[styles.operatorHint, { color: colors.textLight }]}>
                  모임을 만들려면 <Text style={{ color: colors.primary, fontWeight: '700' }}>운영자 신청</Text>이 필요해요
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
        onConfirm={async () => {
          if (!clubName.trim()) return;
          try {
            await createClub(clubName.trim());
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

  // Greeting — large, confident, tight line-height with a muted sub-line.
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    letterSpacing: -0.3,
    fontFamily: typography.h2.fontFamily,
  },
  greetingSub: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 3,
    fontFamily: typography.body2.fontFamily,
  },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    maxWidth: 168,
  },
  skillBadgeLevel: {
    color: palette.white,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  skillBadgeLabel: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    flexShrink: 1,
  },

  // Hero (내 차례)
  heroCard: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    marginBottom: spacing.mlg,
  },
  heroLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.white,
  },
  heroBadgeText: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  heroTitle: {
    color: palette.white,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.4,
    marginBottom: spacing.xs + 1,
    fontFamily: typography.h1.fontFamily,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: spacing.lg,
    fontFamily: typography.body2.fontFamily,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smd,
    borderRadius: radius.xxl,
  },
  heroCtaText: {
    color: palette.white,
    ...typography.button,
  },

  // Sections
  section: {
    marginBottom: spacing.xl,
  },
  sectionHead: {
    marginBottom: spacing.md,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
    letterSpacing: -0.2,
    fontFamily: typography.h3.fontFamily,
  },
  sectionCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '800',
  },
  sectionSub: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 4,
    fontFamily: typography.body2.fontFamily,
  },

  // 운영진 배지 (모임 카드 제목 옆)
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    alignSelf: 'flex-start',
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '800',
  },

  // ─── 내 모임 — 통합 카드 (모임 + 그 모임의 현재 진행 상황) ───
  clubCard: {
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  clubTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  clubIconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubName: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    letterSpacing: -0.2,
    fontFamily: typography.subtitle1.fontFamily,
  },
  clubStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.md,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  clubStatusText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    flex: 1,
    fontFamily: typography.body2.fontFamily,
  },
  clubDivider: {
    height: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    marginHorizontal: -spacing.lg,
  },
  clubPrimaryBtn: {},
  clubActions: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },

  // Footer — tidy anchored section for 모임 만들기 / 참여
  footerCard: {
    marginTop: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
  },
  footerLabel: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    fontFamily: typography.body2.fontFamily,
  },
  footerActions: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  operatorHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // Empty
  emptyWrap: {
    marginTop: spacing.xxl,
  },
});
