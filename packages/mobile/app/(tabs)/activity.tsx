import { useEffect, useCallback, useState } from 'react';
import { StyleSheet, ScrollView, View, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { courtApi } from '../../services/court';
import { profileApi } from '../../services/profile';
import { recruitmentApi } from '../../services/recruitment';
import { clubSessionApi } from '../../services/clubSession';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useRestMode } from '../../hooks/useRestMode';
import { useStatsData } from '../../hooks/useStatsData';
import { useTheme } from '../../hooks/useTheme';
import { useScrollAnimation } from '../../hooks/useScrollAnimation';
import { typography, spacing, radius } from '../../constants/theme';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Strings } from '../../constants/strings';
import { useFadeIn } from '../../utils/animations';
import api from '../../services/api';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { ParallaxHeader } from '../../components/ui/ParallaxHeader';

import { SectionHeader } from '../../components/ui/SectionHeader';
import { GameStatsHeader } from '../../components/activity/GameStatsHeader';
import { RestToggleCard } from '../../components/activity/RestToggleCard';
import { PlayingTurnCard } from '../../components/activity/PlayingTurnCard';
import { WaitingTurnCard } from '../../components/activity/WaitingTurnCard';
import { ClubSessionCard } from '../../components/activity/ClubSessionCard';
import { RecruitmentList } from '../../components/activity/RecruitmentList';
import { TodayHistoryList } from '../../components/activity/TodayHistoryList';
import { FullHistorySection } from '../../components/activity/FullHistorySection';
import { ActivityEmptyState } from '../../components/activity/ActivityEmptyState';
import { ActivitySkeleton } from '../../components/activity/ActivitySkeleton';
import { FeatureHighlight } from '../../components/ui/FeatureHighlight';
import { Skeleton } from '../../components/ui/Skeleton';
import { useLazyScreen } from '../../hooks/useLazyScreen';

interface GameHistoryItem {
  id: string;
  courtName: string;
  status: string;
  gameType: string;
  startedAt: string | null;
  completedAt: string | null;
  players: { userName: string }[];
}

interface RecruitmentItem {
  id: string;
  gameType: string;
  playersRequired: number;
  status: string;
  members: { userId: string; userName: string }[];
}

export default function ActivityScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { myTurns, isLoading, fetchMyTurns } = useTurnStore();
  const { user } = useAuthStore();
  const { status: checkinStatus } = useCheckinStore();
  const { isResting, restDurationMinutes, toggleRest } = useRestMode();
  const [restLoading, setRestLoading] = useState(false);
  const [todayGames, setTodayGames] = useState<GameHistoryItem[]>([]);
  const [myRecruitments, setMyRecruitments] = useState<RecruitmentItem[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const { totalStats, loading: statsLoading, error: statsError, retry: retryStats } = useStatsData();
  const [history, setHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [initialLoaded, setInitialLoaded] = useState(false);
  const { isReady: historyReady } = useLazyScreen(150);

  const facilityId = checkinStatus?.facilityId;
  useUserRoom(user?.id);

  const fadeInStyle = useFadeIn();
  const { scrollY, scrollHandler } = useScrollAnimation();

  useEffect(() => {
    Promise.all([
      fetchMyTurns(),
      loadTodayHistory(),
      loadMyRecruitments(),
      loadActiveClubSession(),
    ]).finally(() => setInitialLoaded(true));
  }, []);

  const loadTodayHistory = async () => {
    try {
      const { data } = await profileApi.getHistory(1);
      const today = new Date().toISOString().split('T')[0];
      const todayItems = (data?.items || data || []).filter((g: any) => {
        const date = (g.completedAt || g.startedAt || g.createdAt || '').split('T')[0];
        return date === today && g.status === 'COMPLETED';
      });
      setTodayGames(todayItems);
    } catch { /* silent */ }
  };

  const loadMyRecruitments = async () => {
    if (!facilityId) return;
    try {
      const { data } = await recruitmentApi.list(facilityId);
      const mine = (data || []).filter((r: any) =>
        r.members?.some((m: any) => m.userId === user?.id)
      );
      setMyRecruitments(mine);
    } catch { /* silent */ }
  };

  const loadActiveClubSession = async () => {
    try {
      const { data: clubs } = await api.get('/clubs');
      for (const club of clubs) {
        try {
          const { data: session } = await clubSessionApi.getActive(club.id);
          if (session && session.status === 'ACTIVE') {
            setActiveSession({ ...session, clubName: club.name, clubId: club.id });
            return;
          }
        } catch { /* no active session */ }
      }
      setActiveSession(null);
    } catch { setActiveSession(null); }
  };

  const refresh = useCallback(() => {
    fetchMyTurns();
    loadTodayHistory();
    loadMyRecruitments();
    loadActiveClubSession();
    retryStats();
  }, [retryStats]);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);

  const handleCompleteTurn = (turnId: string) => {
    showConfirm('게임 종료', '게임을 종료하시겠습니까?', async () => {
      try {
        await courtApi.completeTurn(turnId);
        refresh();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
      }
    }, Strings.turn.complete);
  };

  const handleCancelTurn = (turnId: string) => {
    showConfirm('순번 취소', '순번을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        refresh();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '순번 취소에 실패했습니다');
      }
    }, Strings.turn.cancel);
  };

  const handleExtendTurn = async (turnId: string) => {
    try {
      await courtApi.extendTurn(turnId, 15);
      fetchMyTurns();
      showSuccess('시간이 15분 연장되었습니다');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '시간 연장에 실패했습니다');
    }
  };

  const handleRequeue = (gameId: string) => {
    showConfirm('다시 줄서기', '같은 멤버로 다시 줄서시겠습니까?', async () => {
      try {
        await courtApi.requeueTurn(gameId);
        fetchMyTurns();
        showSuccess('다시 대기열에 등록되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.message || '다시 줄서기에 실패했습니다');
      }
    });
  };

  const loadHistory = async (page: number = 1) => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get('/users/me/history', { params: { page, limit: 10 } });
      const items = data?.items || data || [];
      if (page === 1) {
        setHistory(items);
      } else {
        setHistory((prev) => [...prev, ...items]);
      }
      setHasMoreHistory(items.length >= 10);
      setHistoryPage(page);
    } catch {
      if (page === 1) setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history.length === 0) {
      loadHistory(1);
    }
  };

  const handleLoadMoreHistory = () => {
    if (!historyLoading && hasMoreHistory) {
      loadHistory(historyPage + 1);
    }
  };

  const handleToggleRest = async () => {
    setRestLoading(true);
    try {
      await toggleRest();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '상태 변경에 실패했습니다');
    } finally {
      setRestLoading(false);
    }
  };

  const playingTurns = myTurns.filter((t) => t.status === 'PLAYING');
  const waitingTurns = myTurns.filter((t) => t.status === 'WAITING');
  const hasTurns = myTurns.length > 0;
  const hasCurrentStatus = hasTurns || (checkinStatus != null);
  const hasRecruitments = myRecruitments.length > 0;

  // Show skeleton on first load before any data arrives
  if (!initialLoaded && isLoading) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <ActivitySkeleton />
      </ScrollView>
    );
  }

  return (
    <Animated.ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      refreshControl={
        <AnimatedRefreshControl refreshing={isLoading} onRefresh={refresh} />
      }
    >
      <ParallaxHeader
        title="내 활동"
        subtitle="게임 현황과 기록을 확인하세요"
        scrollY={scrollY}
        height={100}
      />
      <Animated.View style={fadeInStyle}>
        {/* ── Game Stats Pills ────────────────────────── */}
        <GameStatsHeader
          todayGames={todayGames.length}
          totalGames={totalStats.totalGames}
          consecutiveDays={totalStats.consecutiveDays}
          loading={statsLoading}
        />

        {/* ── Stats Error ──────────────────────────────── */}
        {statsError && (
          <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{statsError}</Text>
          </View>
        )}

        {/* ── Summary Header ─────────────────────────── */}
        <View style={[styles.summaryHeader, { backgroundColor: colors.surface }, shadows.md]}>
          <Text style={[styles.summaryTitle, { color: colors.text }]}>오늘 요약</Text>
          <View style={styles.summaryStats}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{todayGames.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textLight }]}>오늘 게임</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{playingTurns.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textLight }]}>진행 중</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{waitingTurns.length}</Text>
              <Text style={[styles.statLabel, { color: colors.textLight }]}>대기 중</Text>
            </View>
          </View>
        </View>

        {/* ── Current Status Section ─────────────────── */}
        {hasCurrentStatus && (
          <>
            <SectionHeader title="현재 상태" count={playingTurns.length + waitingTurns.length} />

            {!hasTurns && checkinStatus && (
              <FeatureHighlight
                featureKey="rest_toggle"
                message="휴식 모드를 켜면 순번 배정에서 제외됩니다"
                position="top"
              >
                <RestToggleCard
                  isResting={isResting}
                  restLoading={restLoading}
                  onToggle={handleToggleRest}
                  restDurationMinutes={restDurationMinutes}
                />
              </FeatureHighlight>
            )}

            {playingTurns.map((turn) => (
              <PlayingTurnCard
                key={turn.turnId}
                courtName={turn.courtName}
                timeLimitAt={(turn as any).timeLimitAt}
                players={turn.players}
                currentUserId={user?.id}
                onExtend={() => handleExtendTurn(turn.turnId)}
                onComplete={() => handleCompleteTurn(turn.turnId)}
              />
            ))}

            {waitingTurns.map((turn) => (
              <WaitingTurnCard
                key={turn.turnId}
                courtName={turn.courtName}
                position={turn.position}
                players={turn.players}
                currentUserId={user?.id}
                onCancel={() => handleCancelTurn(turn.turnId)}
              />
            ))}

            <View style={[styles.sectionDivider, { backgroundColor: colors.divider }]} />
          </>
        )}

        {/* ── Club Session ───────────────────────────── */}
        {activeSession && (
          <>
            <SectionHeader title="클럽 세션" />
            <ClubSessionCard
              clubName={activeSession.clubName}
              onPress={() => router.push(`/club/${activeSession.clubId}/session`)}
            />
            <View style={[styles.sectionDivider, { backgroundColor: colors.divider }]} />
          </>
        )}

        {/* ── My Recruitments ────────────────────────── */}
        {hasRecruitments && (
          <>
            <SectionHeader title="모집 현황" count={myRecruitments.length} />
            <RecruitmentList recruitments={myRecruitments} />
            <View style={[styles.sectionDivider, { backgroundColor: colors.divider }]} />
          </>
        )}

        {/* ── Empty State ────────────────────────────── */}
        {myTurns.length === 0 && myRecruitments.length === 0 && !activeSession && (
          <ActivityEmptyState />
        )}

        {/* ── Today History ──────────────────────────── */}
        <SectionHeader title="오늘 기록" count={todayGames.length} />
        <TodayHistoryList games={todayGames} onRequeue={handleRequeue} />

        <View style={[styles.sectionDivider, { backgroundColor: colors.divider }]} />

        {/* ── Full History ───────────────────────────── */}
        {historyReady ? (
          <FullHistorySection
            showHistory={showHistory}
            history={history}
            historyLoading={historyLoading}
            hasMoreHistory={hasMoreHistory}
            onToggle={handleToggleHistory}
            onLoadMore={handleLoadMoreHistory}
          />
        ) : (
          <Skeleton width="100%" height={48} borderRadius={12} />
        )}
      </Animated.View>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, flexGrow: 1, paddingBottom: spacing.xxxxl },

  // Summary header
  summaryHeader: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  summaryTitle: {
    ...typography.h3,
    marginBottom: spacing.lg,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    ...typography.h2,
  },
  statLabel: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
  },

  // Section divider
  sectionDivider: {
    height: 1,
    marginVertical: spacing.xl,
  },

  // Error banner
  errorBanner: {
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  errorText: {
    ...typography.caption,
  },
});
