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
import { getSkillMeta } from '../../constants/skill';
import { typography, spacing, radius, palette } from '../../constants/theme';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
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

function formatSessionTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getHours();
  const mm = d.getMinutes();
  const ampm = hh < 12 ? '오전' : '오후';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const mmStr = mm === 0 ? '' : ` ${String(mm).padStart(2, '0')}분`;
  return `${ampm} ${h12}시${mmStr} 시작`;
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

  const activeClubIds = useMemo(
    () => new Set(activeSessions.map((s) => s.clubId)),
    [activeSessions],
  );

  const clubsWithoutSession = useMemo(
    () => (clubs as any[]).filter((c) => !activeClubIds.has(c.id)),
    [clubs, activeClubIds],
  );

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

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.greetingRow}>
            <SkeletonGroup>
              <Skeleton width={160} height={26} borderRadius={radius.sm} />
              <Skeleton width={220} height={16} borderRadius={radius.sm} style={{ marginTop: spacing.sm }} />
            </SkeletonGroup>
          </View>
          <View style={{ height: spacing.xl }} />
          <Skeleton width="100%" height={140} borderRadius={radius.card} />
          <View style={{ height: spacing.lg }} />
          <Skeleton width="100%" height={120} borderRadius={radius.card} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
              <Text style={styles.skillBadgeLabel}>{skillMeta.description}</Text>
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
              shadows.colored(colors.secondary),
              pressed && { opacity: 0.92 },
            ]}
          >
            <View style={styles.heroBadge}>
              <View style={styles.heroLiveDot} />
              <Text style={styles.heroBadgeText}>내 차례</Text>
            </View>
            <Text style={styles.heroTitle}>{playingTurn.courtName} · 게임 시작</Text>
            <Text style={styles.heroSub}>
              지금 바로 코트로 가세요! 탭하면 게임 화면이 열려요.
            </Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>게임 보기</Text>
              <Icon name="chevronRight" size={18} color={palette.white} />
            </View>
          </Pressable>
        )}

        {/* ─── 3. 진행 중인 정모 ─── */}
        {activeSessions.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="진행 중인 정모" count={activeSessions.length} />
            {activeSessions.map((s) => {
              const checkedIn = isCheckedInToSession(s);
              const isStaff = staffClubIds.has(s.clubId);
              return (
                <View
                  key={s.id}
                  style={[styles.sessionCard, { backgroundColor: colors.surface }, shadows.md]}
                >
                  {/* live ribbon */}
                  <View style={styles.sessionTopRow}>
                    <View style={[styles.livePill, { backgroundColor: colors.secondaryLight }]}>
                      <View style={[styles.livePillDot, { backgroundColor: colors.secondary }]} />
                      <Text style={[styles.livePillText, { color: colors.secondary }]}>진행 중</Text>
                    </View>
                    {isStaff && (
                      <View style={[styles.rolePill, { backgroundColor: colors.warningLight }]}>
                        <Icon name="leader" size={12} color={colors.warning} />
                        <Text style={[styles.rolePillText, { color: colors.warning }]}>운영진</Text>
                      </View>
                    )}
                  </View>

                  <Text style={[styles.sessionClub, { color: colors.text }]} numberOfLines={1}>
                    {s.title || `${s.clubName} 정모`}
                  </Text>

                  <View style={styles.sessionMetaRow}>
                    <Icon name="map" size={14} color={colors.textLight} />
                    <Text style={[styles.sessionMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {s.facilityName}
                    </Text>
                  </View>
                  {!!formatSessionTime(s.scheduledStartAt || s.startedAt) && (
                    <View style={styles.sessionMetaRow}>
                      <Icon name="timer" size={14} color={colors.textLight} />
                      <Text style={[styles.sessionMeta, { color: colors.textSecondary }]}>
                        {formatSessionTime(s.scheduledStartAt || s.startedAt)}
                      </Text>
                    </View>
                  )}

                  {/* player state — board-aware when this session is the one I'm in.
                      Split into a status label + distinct 순번 / 코트 chips so it's
                      legible at a glance rather than one crammed line. */}
                  {checkedIn ? (
                    (() => {
                      const mine = myStatus && myStatus.clubSessionId === s.id ? myStatus : null;
                      const isPlaying = mine?.status === 'PLAYING';
                      const isQueued = mine?.status === 'QUEUED';
                      const order = mine?.queueOrder ?? 0;

                      let icon: 'success' | 'play' | 'waiting' = 'success';
                      let label = '대기 중';
                      let sub = '배정되면 알림이 와요';
                      let tint = colors.secondary;
                      let bg = colors.secondaryBg;
                      let orderChip: string | null = null;
                      let courtChip: string | null = null;

                      if (isPlaying) {
                        icon = 'play';
                        tint = colors.playerInTurn;
                        bg = colors.dangerBg;
                        label = '게임 중';
                        sub = '지금 코트로 가세요';
                        courtChip = mine?.courtName ?? null;
                      } else if (isQueued) {
                        icon = 'waiting';
                        tint = colors.primary;
                        bg = colors.primaryBg;
                        label = '다음 게임';
                        sub = '배정되면 알림이 와요';
                        orderChip = order > 0 ? `대기 ${order}번째` : null;
                        courtChip = mine?.courtName ?? '코트 미정';
                      }

                      const strong = isPlaying || isQueued;
                      return (
                        <View style={[styles.statePanel, { backgroundColor: bg }, strong && { borderColor: tint, borderWidth: 1.5 }]}>
                          <View style={styles.stateHeadRow}>
                            <View style={[styles.stateIcon, { backgroundColor: tint }]}>
                              <Icon name={icon} size={16} color={palette.white} />
                            </View>
                            <Text style={[styles.stateLabel, { color: tint }]}>{label}</Text>
                          </View>
                          {(orderChip || courtChip) && (
                            <View style={styles.stateChipRow}>
                              {orderChip && (
                                <View style={[styles.stateChip, { backgroundColor: tint }]}>
                                  <Text style={styles.stateChipText}>{orderChip}</Text>
                                </View>
                              )}
                              {courtChip && (
                                <View style={[styles.stateChipOutline, { borderColor: tint }]}>
                                  <Icon name="court" size={13} color={tint} />
                                  <Text style={[styles.stateChipOutlineText, { color: tint }]}>{courtChip}</Text>
                                </View>
                              )}
                            </View>
                          )}
                          <Text style={[styles.stateSub, { color: colors.textSecondary }]}>{sub}</Text>
                        </View>
                      );
                    })()
                  ) : (
                    <Button
                      title="체크인"
                      icon="checkin"
                      size="lg"
                      fullWidth
                      onPress={() => router.push(`/checkin-modal?clubSessionId=${s.id}`)}
                      style={styles.checkinBtn}
                    />
                  )}

                  {/* Actions grouped on one row so the card isn't a tall button stack.
                      현황 보기 is always available; 운영판 sits beside it for staff. */}
                  <View style={styles.sessionActions}>
                    <Button
                      title="현황 보기"
                      icon="tv"
                      variant={isStaff ? 'outline' : 'primary'}
                      size="md"
                      onPress={() => router.push(`/session/${s.id}/board`)}
                      style={{ flex: 1 }}
                    />
                    {isStaff && (
                      <Button
                        title="운영판"
                        icon="board"
                        variant="primary"
                        size="md"
                        onPress={() => router.push(`/session/${s.id}/operate`)}
                        style={{ flex: 1 }}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ─── 4. 내 모임 (정모 없는 클럽) ─── */}
        {clubs.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="내 모임"
              count={clubs.length}
              action={{ label: '+ 모임', onPress: () => setShowJoin(true) }}
            />
            {clubsWithoutSession.length === 0 ? (
              <Text style={[styles.allActiveNote, { color: colors.textLight }]}>
                모든 모임이 정모 진행 중이에요
              </Text>
            ) : (
              clubsWithoutSession.map((c: any) => {
                const isStaff = staffClubIds.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/club/${c.id}`)}
                    style={({ pressed }) => [
                      styles.clubCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <View style={[styles.clubIconWrap, { backgroundColor: colors.primaryLight }]}>
                      <Icon name="club" size={22} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.clubName, { color: colors.text }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={[styles.clubMeta, { color: colors.textLight }]}>
                        멤버 {c.memberCount ?? 0}명
                        {isStaff ? ' · 운영진' : ''}
                      </Text>
                    </View>
                    <Icon name="chevronRight" size={20} color={colors.textLight} />
                  </Pressable>
                );
              })
            )}
            <View style={styles.clubActions}>
              <Button
                title="모임 만들기"
                icon="add"
                variant="outline"
                size="md"
                onPress={() => setShowCreate(true)}
                style={{ flex: 1 }}
              />
              <Button
                title="모임 참여"
                icon="link"
                variant="ghost"
                size="md"
                onPress={() => setShowJoin(true)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        {/* ─── 5. Empty state (no clubs) ─── */}
        {clubs.length === 0 && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="club"
              title="아직 참여한 모임이 없어요"
              description="모임에 참여하면 정모 일정과 체크인, 게임 배정을 한눈에 볼 수 있어요."
              action={{ label: '모임 참여하기', onPress: () => setShowJoin(true), icon: 'link' }}
              secondaryAction={{ label: '새 모임 만들기', onPress: () => setShowCreate(true) }}
            />
          </View>
        )}
      </ScrollView>

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

  // Greeting
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  greeting: {
    ...typography.h2,
  },
  greetingSub: {
    ...typography.body2,
    marginTop: 2,
  },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  skillBadgeLevel: {
    color: palette.white,
    fontSize: 13,
    fontWeight: '900',
  },
  skillBadgeLabel: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '700',
  },

  // Hero (내 차례)
  heroCard: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.md,
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
    letterSpacing: 0.5,
  },
  heroTitle: {
    color: palette.white,
    ...typography.h1,
    marginBottom: spacing.xs,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.92)',
    ...typography.body2,
    marginBottom: spacing.lg,
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

  // 정모 card
  sessionCard: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.md,
  },
  sessionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  livePillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  livePillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sessionClub: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  sessionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sessionMeta: {
    ...typography.body2,
    flex: 1,
  },
  checkinBtn: {
    marginTop: spacing.lg,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },

  // Player-state panel — split label + 순번/코트 chips (replaces the crammed pill)
  statePanel: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  stateHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stateIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  stateLabel: { ...typography.h3, flex: 1 },
  stateChipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  stateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  stateChipText: { color: palette.white, ...typography.subtitle2, fontSize: 15 },
  stateChipOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  stateChipOutlineText: { ...typography.subtitle2, fontSize: 15 },
  stateSub: { ...typography.body2 },

  // Club cards
  allActiveNote: {
    ...typography.body2,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  clubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  clubIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubName: {
    ...typography.subtitle1,
  },
  clubMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  clubActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },

  // Empty
  emptyWrap: {
    marginTop: spacing.xxl,
  },
});
