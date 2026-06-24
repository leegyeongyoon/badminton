import { useEffect, useCallback, useState, useMemo } from 'react';
import { StyleSheet, ScrollView, View, Text, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTurnStore } from '../../store/turnStore';
import { useAuthStore } from '../../store/authStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useClubStore } from '../../store/clubStore';
import { clubSessionApi } from '../../services/clubSession';
import { courtApi } from '../../services/court';
import { profileApi, MyStatusResponse } from '../../services/profile';
import { useSocketEvent, useUserRoom } from '../../hooks/useSocket';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius, palette } from '../../constants/theme';
import { showAlert, showConfirm } from '../../utils/alert';
import { Strings } from '../../constants/strings';
import { AnimatedRefreshControl } from '../../components/ui/AnimatedRefreshControl';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
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
  // Board-aware status (QUEUED/PLAYING/AVAILABLE) from /users/me/status so a
  // court-less QUEUED entry surfaces as "다음 게임 · 대기 N번째" not a flat 대기 중.
  const [myStatus, setMyStatus] = useState<MyStatusResponse | null>(null);

  useUserRoom(user?.id);

  const fetchMyStatus = useCallback(async () => {
    try {
      const { data } = await profileApi.getMyStatus();
      setMyStatus(data ?? null);
    } catch {
      setMyStatus(null);
    }
  }, []);

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
    fetchMyStatus();
    resolveActiveSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    fetchMyTurns();
    fetchMyStatus();
    resolveActiveSession();
  }, [fetchMyTurns, fetchMyStatus, resolveActiveSession]);

  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);
  useSocketEvent('clubSession:started', refresh);
  useSocketEvent('clubSession:ended', refresh);
  // Board events: my QUEUED/배정 state changes when the operator stages/pushes.
  useSocketEvent('gameBoard:entryAdded', refresh);
  useSocketEvent('gameBoard:entryUpdated', refresh);
  useSocketEvent('gameBoard:entryPushed', refresh);
  useSocketEvent('gameBoard:entryRemoved', refresh);
  useSocketEvent('gameBoard:reordered', refresh);

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

  // The headline state shown at the top. PLAYING/QUEUED come from the board-aware
  // /users/me/status (covers a court-less QUEUED entry with no TurnPlayer);
  // myTurns is the fallback so an on-court turn still shows even before status loads.
  const state: 'playing' | 'queued' | 'checkedIn' | 'idle' =
    myStatus?.status === 'PLAYING' || playingTurn
      ? 'playing'
      : myStatus?.status === 'QUEUED' || waitingTurn
        ? 'queued'
        : checkinStatus
          ? 'checkedIn'
          : 'idle';

  const playingCourt = myStatus?.courtName ?? playingTurn?.courtName ?? null;

  // Order number (대기 N번째) + court chip, split out so the hero can show them
  // as distinct, larger elements instead of one crammed line.
  const orderNum = myStatus?.queueOrder ?? (waitingTurn?.position ?? 0);
  const courtNameVal = playingCourt ?? (myStatus?.courtName ?? waitingTurn?.courtName ?? null);

  const stateMeta = {
    playing: {
      tint: colors.playerInTurn,
      bg: colors.dangerBg,
      label: '게임 중',
      sub: '지금 코트에서 경기 중이에요',
      icon: 'play' as const,
      courtChip: courtNameVal,
      orderChip: null as string | null,
    },
    queued: {
      tint: colors.primary,
      bg: colors.primaryBg,
      label: '다음 게임 대기',
      sub: '배정되면 알림이 와요',
      icon: 'waiting' as const,
      courtChip: courtNameVal ?? '코트 미정',
      orderChip: orderNum > 0 ? `대기 ${orderNum}번째` : null,
    },
    checkedIn: {
      tint: colors.secondary,
      bg: colors.secondaryBg,
      label: '대기 중',
      sub: checkinStatus ? `${checkinStatus.facilityName} 체크인 완료` : '',
      icon: 'success' as const,
      courtChip: null,
      orderChip: null,
    },
    idle: {
      tint: colors.textLight,
      bg: colors.surfaceSecondary,
      label: '체크인 전',
      sub: '정모에 체크인하면 현황이 여기에 나와요',
      icon: 'court' as const,
      courtChip: null,
      orderChip: null,
    },
  }[state];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
    <ScreenContainer>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        Platform.OS === 'web' ? undefined : (
          <AnimatedRefreshControl refreshing={isLoading} onRefresh={refresh} />
        )
      }
    >
      {/* Headline: my current state — big label + distinct 순번/코트 chips */}
      <View style={[styles.statusHero, { backgroundColor: stateMeta.bg }, shadows.sm]}>
        <View style={[styles.statusIcon, { backgroundColor: stateMeta.tint }]}>
          <Icon name={stateMeta.icon} size={26} color={palette.white} />
        </View>
        <Text style={[styles.statusLabel, { color: stateMeta.tint }]}>{stateMeta.label}</Text>
        {(stateMeta.orderChip || stateMeta.courtChip) && (
          <View style={styles.chipRow}>
            {stateMeta.orderChip && (
              <View style={[styles.heroChip, { backgroundColor: stateMeta.tint }]}>
                <Text style={styles.heroChipText}>{stateMeta.orderChip}</Text>
              </View>
            )}
            {stateMeta.courtChip && (
              <View style={[styles.heroChipOutline, { borderColor: stateMeta.tint }]}>
                <Icon name="court" size={14} color={stateMeta.tint} />
                <Text style={[styles.heroChipOutlineText, { color: stateMeta.tint }]}>{stateMeta.courtChip}</Text>
              </View>
            )}
          </View>
        )}
        {!!stateMeta.sub && (
          <Text style={[styles.statusSub, { color: colors.textSecondary }]}>{stateMeta.sub}</Text>
        )}
      </View>

      {/* Prominent live board entry — the PRIMARY action most players want */}
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
          <Icon name="tv" size={22} color={palette.white} />
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
    </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.xl, flexGrow: 1, paddingBottom: spacing.xxxxl, gap: spacing.lg },

  statusHero: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.smd,
  },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statusLabel: { ...typography.h1 },
  statusSub: { ...typography.body2, textAlign: 'center' },

  // 순번 + 코트 chips, shown as distinct larger elements under the status label
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  heroChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  heroChipText: { color: palette.white, ...typography.subtitle1 },
  heroChipOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  heroChipOutlineText: { ...typography.subtitle1 },

  boardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderRadius: radius.card,
  },
  boardBtnText: { color: palette.white, ...typography.button, fontSize: 17 },
});
