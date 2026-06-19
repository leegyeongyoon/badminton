import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useTurnStore } from '../store/turnStore';
import { useCheckinStore } from '../store/checkinStore';
import { useUserRoom, useSocketEvent } from '../hooks/useSocket';
import { useSocketToast } from '../hooks/useSocketToast';
import { useTheme } from '../hooks/useTheme';
import { palette, typography, spacing, radius } from '../constants/theme';
import { Icon } from '../components/ui/Icon';
import { Button } from '../components/ui/Button';

const POLL_INTERVAL_MS = 8000;

/**
 * Minimal post-check-in screen for a guest. Guests do NOT get the member
 * tabs/clubs — just a waiting state that flips to a "내 차례" court card when
 * the operator places them in a game (driven by polling + the socket
 * `turn:started` event, which also raises the global TurnBanner).
 */
export default function GuestStatusScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { user, logout } = useAuthStore();
  const { myTurns, fetchMyTurns } = useTurnStore();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const [loggingOut, setLoggingOut] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The guest's check-in carries the clubSessionId — used to open the live board.
  const clubSessionId = checkinStatus?.clubSessionId;

  // Join the user's socket room so turn:started fires the banner for THIS guest.
  useUserRoom(user?.id);
  // Reuse the same socket toast/banner wiring members get.
  useSocketToast();

  const refresh = useCallback(() => {
    fetchStatus().catch(() => {});
    fetchMyTurns().finally(() => setLoaded(true));
  }, [fetchMyTurns, fetchStatus]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // React immediately to turn lifecycle events.
  useSocketEvent('turn:started', refresh);
  useSocketEvent('turn:completed', refresh);
  useSocketEvent('turn:promoted', refresh);
  useSocketEvent('turn:cancelled', refresh);

  const handleLeave = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      // Root layout gate sends an unauthenticated user to login, but replace
      // explicitly so the back stack is clean.
      router.replace('/(auth)/login');
    }
  }, [logout, router]);

  const playingTurns = myTurns.filter((t) => t.status === 'PLAYING');
  const waitingTurns = myTurns.filter((t) => t.status === 'WAITING');
  const playing = playingTurns[0];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.headerBlock}>
        <View style={[styles.badge, { backgroundColor: colors.secondaryLight }]}>
          <Icon name="success" size={20} color={colors.secondary} />
          <Text style={[styles.badgeText, { color: colors.secondary }]}>출석 완료</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          출석 완료 🏸 {user?.name ? `${user.name}님` : '게스트님'}
        </Text>
      </View>

      {/* My turn card OR waiting state */}
      {playing ? (
        <View style={[styles.turnCard, { backgroundColor: colors.primary }, shadows.lg]}>
          <Text style={styles.turnCardLabel}>내 차례예요!</Text>
          <Text style={styles.turnCardCourt}>
            {playing.courtName || '코트'}
          </Text>
          <Text style={styles.turnCardSub}>코트로 입장하세요</Text>
          {playing.players?.length > 0 && (
            <View style={styles.playersRow}>
              {playing.players.map((p) => (
                <View key={p.id} style={styles.playerChip}>
                  <Text style={styles.playerChipText} numberOfLines={1}>
                    {p.userName}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.waitCard, { backgroundColor: colors.surface }, shadows.md]}>
          <View style={[styles.waitIconWrap, { backgroundColor: colors.primaryBg }]}>
            {loaded ? (
              <Icon name="waiting" size={36} color={colors.primary} />
            ) : (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
          </View>
          <Text style={[styles.waitTitle, { color: colors.text }]}>대기 중</Text>
          <Text style={[styles.waitDesc, { color: colors.textSecondary }]}>
            운영자가 게임에 배정하면 알려드려요.{'\n'}이 화면을 켜둔 채 잠시 기다려주세요.
          </Text>
          {waitingTurns.length > 0 && (
            <View style={[styles.queueBadge, { backgroundColor: colors.primaryBg }]}>
              <Text style={[styles.queueBadgeText, { color: colors.primary }]}>
                대기열 {waitingTurns[0].position}번
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Live board (open to guests) */}
      {clubSessionId && (
        <Button
          title="게임 현황 보기"
          icon="tv"
          variant="primary"
          onPress={() => router.push(`/session/${clubSessionId}/board`)}
          fullWidth
          style={styles.boardButton}
        />
      )}

      {/* Leave */}
      <Button
        title="나가기"
        onPress={handleLeave}
        variant="outline"
        loading={loggingOut}
        disabled={loggingOut}
        fullWidth
        style={styles.leaveButton}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing.xxxxl + spacing.xl,
    gap: spacing.xl,
  },
  headerBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.xxl,
  },
  badgeText: {
    ...typography.subtitle2,
    fontWeight: '700',
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
  },
  // Playing turn card
  turnCard: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  turnCardLabel: {
    ...typography.subtitle2,
    color: palette.white,
    opacity: 0.9,
  },
  turnCardCourt: {
    ...typography.h1,
    color: palette.white,
  },
  turnCardSub: {
    ...typography.body1,
    color: palette.white,
    opacity: 0.9,
  },
  playersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  playerChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  playerChipText: {
    ...typography.caption,
    color: palette.white,
    fontWeight: '600',
  },
  // Waiting card
  waitCard: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  waitIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  waitTitle: {
    ...typography.h3,
    textAlign: 'center',
  },
  waitDesc: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 22,
  },
  queueBadge: {
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  queueBadgeText: {
    ...typography.subtitle2,
    fontWeight: '700',
  },
  boardButton: {
    marginTop: 'auto',
  },
  leaveButton: {
    marginTop: spacing.md,
  },
});
