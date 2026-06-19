import { useEffect, useCallback, useState, useMemo } from 'react';
import { StyleSheet, ScrollView, View, Text, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useClubStore } from '../../store/clubStore';
import { clubSessionApi } from '../../services/clubSession';
import { courtApi } from '../../services/court';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius, palette } from '../../constants/theme';
import { showAlert, showConfirm } from '../../utils/alert';
import { Strings } from '../../constants/strings';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { PlayingTurnCard } from '../../components/activity/PlayingTurnCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon } from '../../components/ui/Icon';

/**
 * 내 현황 — the player's minimal "enter → see the live situation" surface.
 *
 * Shows ONE thing clearly: my current state right now
 *   대기 중 / 내 차례 (코트 N) / 게임 중
 * plus a prominent "현황 보드 보기" button into the live session board.
 *
 * Intentionally simplified: no self-rest("쉬기") toggle, no history/stats
 * clutter — a player just enters and sees what's happening.
 */
export default function MyStatusScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { myTurns, isLoading, fetchMyTurns } = useTurnStore();
  const { user } = useAuthStore();
  const { status: checkinStatus } = useCheckinStore();
  const { clubs, fetchClubs } = useClubStore();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useUserRoom(user?.id);

  // Derive the active session id for the board button:
  //  1) prefer the session we checked into,
  //  2) else find any ACTIVE session across the player's clubs.
  const resolveActiveSession = useCallback(async () => {
    if (checkinStatus?.clubSessionId) {
      setActiveSessionId(checkinStatus.clubSessionId);
      return;
    }
    await fetchClubs();
    const list = useClubStore.getState().clubs as { id: string }[];
    if (list.length === 0) {
      setActiveSessionId(null);
      return;
    }
    const results = await Promise.all(
      list.map((c) =>
        clubSessionApi.getActive(c.id).then((r) => r.data).catch(() => null),
      ),
    );
    const active = results.find((s: any) => s && s.status === 'ACTIVE');
    setActiveSessionId(active ? active.id : null);
  }, [checkinStatus?.clubSessionId, fetchClubs]);

  useEffect(() => {
    fetchMyTurns();
    resolveActiveSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    fetchMyTurns();
    resolveActiveSession();
  }, [fetchMyTurns, resolveActiveSession]);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);
  useSocketEvent('clubSession:started', refresh);
  useSocketEvent('clubSession:ended', refresh);

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

  const handleExtendTurn = async (turnId: string) => {
    try {
      await courtApi.extendTurn(turnId, 15);
      fetchMyTurns();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '시간 연장에 실패했습니다');
    }
  };

  const playingTurn = useMemo(() => myTurns.find((t) => t.status === 'PLAYING'), [myTurns]);
  const waitingTurn = useMemo(() => myTurns.find((t) => t.status === 'WAITING'), [myTurns]);

  // The headline state shown at the top.
  const state: 'playing' | 'waiting' | 'checkedIn' | 'idle' = playingTurn
    ? 'playing'
    : waitingTurn
      ? 'waiting'
      : checkinStatus
        ? 'checkedIn'
        : 'idle';

  const stateMeta = {
    playing: {
      tint: colors.playerInTurn,
      bg: colors.dangerBg,
      label: '게임 중',
      sub: playingTurn ? `${playingTurn.courtName} · 지금 경기 중이에요` : '',
      icon: 'play' as const,
    },
    waiting: {
      tint: colors.primary,
      bg: colors.primaryBg,
      label: waitingTurn && waitingTurn.position > 0 ? `대기 중 · ${waitingTurn.position}번째` : '대기 중',
      sub: '배정되면 여기와 알림으로 바로 알려드려요',
      icon: 'waiting' as const,
    },
    checkedIn: {
      tint: colors.secondary,
      bg: colors.secondaryBg,
      label: '대기 중',
      sub: checkinStatus ? `${checkinStatus.facilityName} 체크인 완료` : '',
      icon: 'success' as const,
    },
    idle: {
      tint: colors.textLight,
      bg: colors.surfaceSecondary,
      label: '체크인 전',
      sub: '정모에 체크인하면 현황이 여기에 나와요',
      icon: 'court' as const,
    },
  }[state];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        Platform.OS === 'web' ? undefined : (
          <AnimatedRefreshControl refreshing={isLoading} onRefresh={refresh} />
        )
      }
    >
      {/* Headline: my current state */}
      <View style={[styles.statusHero, { backgroundColor: stateMeta.bg }, shadows.sm]}>
        <View style={[styles.statusIcon, { backgroundColor: stateMeta.tint }]}>
          <Icon name={stateMeta.icon} size={22} color={palette.white} />
        </View>
        <Text style={[styles.statusLabel, { color: stateMeta.tint }]}>{stateMeta.label}</Text>
        {!!stateMeta.sub && (
          <Text style={[styles.statusSub, { color: colors.textSecondary }]}>{stateMeta.sub}</Text>
        )}
      </View>

      {/* Prominent live board entry */}
      {activeSessionId && (
        <Pressable
          onPress={() => router.push(`/session/${activeSessionId}/board`)}
          style={({ pressed }) => [
            styles.boardBtn,
            { backgroundColor: colors.primary },
            shadows.colored(colors.primary),
            pressed && { opacity: 0.92 },
          ]}
        >
          <Icon name="tv" size={20} color={palette.white} />
          <Text style={styles.boardBtnText}>현황 보드 보기</Text>
          <Icon name="chevronRight" size={20} color={palette.white} />
        </Pressable>
      )}

      {/* My active game — lets me end/extend my own turn */}
      {playingTurn && (
        <PlayingTurnCard
          key={playingTurn.turnId}
          courtName={playingTurn.courtName}
          timeLimitAt={(playingTurn as any).timeLimitAt}
          players={playingTurn.players}
          currentUserId={user?.id}
          onExtend={() => handleExtendTurn(playingTurn.turnId)}
          onComplete={() => handleCompleteTurn(playingTurn.turnId)}
        />
      )}

      {/* Idle empty state */}
      {state === 'idle' && (
        <EmptyState
          icon="court"
          title="체크인 후 이용할 수 있습니다"
          description="홈에서 정모에 체크인하면 내 현황을 볼 수 있어요"
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, flexGrow: 1, paddingBottom: spacing.xxxxl, gap: spacing.lg },

  statusHero: {
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statusLabel: { ...typography.h2 },
  statusSub: { ...typography.body2, textAlign: 'center' },

  boardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.card,
  },
  boardBtnText: { color: palette.white, ...typography.button, fontSize: 16 },
});
