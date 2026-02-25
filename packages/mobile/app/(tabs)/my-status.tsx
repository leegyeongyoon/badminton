import { useEffect, useCallback, useState } from 'react';
import { StyleSheet, ScrollView, View, Text } from 'react-native';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { courtApi } from '../../services/court';
import { profileApi } from '../../services/profile';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useRestMode } from '../../hooks/useRestMode';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Strings } from '../../constants/strings';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { RestToggleCard } from '../../components/activity/RestToggleCard';
import { PlayingTurnCard } from '../../components/activity/PlayingTurnCard';
import { WaitingTurnCard } from '../../components/activity/WaitingTurnCard';
import { TodayHistoryList } from '../../components/activity/TodayHistoryList';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../components/ui/Icon';

interface GameHistoryItem {
  id: string;
  courtName: string;
  status: string;
  gameType: string;
  startedAt: string | null;
  completedAt: string | null;
  players: { userName: string }[];
}

export default function MyStatusScreen() {
  const { colors, shadows } = useTheme();
  const { myTurns, isLoading, fetchMyTurns } = useTurnStore();
  const { user } = useAuthStore();
  const { status: checkinStatus } = useCheckinStore();
  const { isResting, restDurationMinutes, toggleRest } = useRestMode();
  const [restLoading, setRestLoading] = useState(false);
  const [todayGames, setTodayGames] = useState<GameHistoryItem[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);

  useUserRoom(user?.id);

  useEffect(() => {
    Promise.all([fetchMyTurns(), loadTodayHistory()]).finally(() =>
      setInitialLoaded(true),
    );
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
    } catch {
      /* silent */
    }
  };

  const refresh = useCallback(() => {
    fetchMyTurns();
    loadTodayHistory();
  }, []);

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
    showConfirm('고깔 취소', '고깔을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        refresh();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '고깔 취소에 실패했습니다');
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <AnimatedRefreshControl refreshing={isLoading} onRefresh={refresh} />
      }
    >
      {/* Checkin status */}
      {checkinStatus && (
        <View style={[styles.checkinCard, { backgroundColor: colors.surface }, shadows.sm]}>
          <Icon name="court" size={16} color={colors.secondary} />
          <Text style={[styles.checkinText, { color: colors.text }]}>
            {checkinStatus.facilityName}
          </Text>
          <Text style={[styles.checkinTime, { color: colors.textLight }]}>
            체크인 중
          </Text>
        </View>
      )}

      {/* Playing turns */}
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

      {/* Waiting turns */}
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

      {/* Rest toggle */}
      {checkinStatus && myTurns.length === 0 && (
        <RestToggleCard
          isResting={isResting}
          restLoading={restLoading}
          onToggle={handleToggleRest}
          restDurationMinutes={restDurationMinutes}
        />
      )}

      {/* Empty state */}
      {!checkinStatus && myTurns.length === 0 && (
        <EmptyState
          icon="court"
          title="체크인 후 이용할 수 있습니다"
          description="코트 탭에서 고깔을 놓아보세요"
        />
      )}

      {/* Today history */}
      {todayGames.length > 0 && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.divider }]} />
          <SectionHeader title="오늘 기록" count={todayGames.length} />
          <TodayHistoryList games={todayGames} onRequeue={handleRequeue} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, flexGrow: 1, paddingBottom: spacing.xxxxl },
  checkinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.card,
    marginBottom: spacing.lg,
  },
  checkinText: {
    ...typography.subtitle2,
    flex: 1,
  },
  checkinTime: {
    ...typography.caption,
  },
  divider: {
    height: 1,
    marginVertical: spacing.xl,
  },
});
