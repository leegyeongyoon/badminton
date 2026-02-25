import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { StatusDot } from '../ui/StatusDot';
import { CountdownTimer } from '../shared/CountdownTimer';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius, createShadow } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Strings } from '../../constants/strings';
import { usePulse, useScalePress, useFadeIn } from '../../utils/animations';
import { haptics } from '../../utils/haptics';

interface Player {
  id: string;
  userId: string;
  userName: string;
}

interface PlayingTurnCardProps {
  courtName: string;
  timeLimitAt?: string;
  players: Player[];
  currentUserId?: string;
  onExtend: () => void;
  onComplete: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PlayingTurnCard({ courtName, timeLimitAt, players, currentUserId, onExtend, onComplete }: PlayingTurnCardProps) {
  const { colors, shadows } = useTheme();
  const fadeInStyle = useFadeIn();
  const pulseStyle = usePulse(0.4, 1, 1200);
  const extendPress = useScalePress(0.96);
  const completePress = useScalePress(0.96);

  return (
    <Animated.View style={[styles.card, { backgroundColor: colors.surface, ...createShadow(6, 16, 0.2, 6, colors.secondary) }, fadeInStyle]}>
      {/* Green header band */}
      <View style={[styles.headerBand, { backgroundColor: colors.secondary }]}>
        <Animated.View style={[styles.liveBadge, pulseStyle]}>
          <StatusDot color={palette.white} size="md" pulse />
          <Text style={styles.liveText}>LIVE</Text>
        </Animated.View>
        <Text style={styles.label}>{Strings.mygame.inProgress}</Text>
      </View>

      <View style={styles.body}>
        {/* Court name */}
        <Text style={[styles.courtName, { color: colors.text }]}>{courtName}</Text>

        {/* Large countdown timer */}
        {timeLimitAt && (
          <View style={styles.timerSection}>
            <CountdownTimer timeLimitAt={timeLimitAt} mode="large" />
          </View>
        )}

        {/* Horizontal avatar row with player names */}
        <View style={styles.playersSection}>
          <Text style={[styles.playersSectionTitle, { color: colors.textLight }]}>참가자</Text>
          <View style={[styles.playersList, { backgroundColor: colors.background }]}>
            {players.map((p, i) => (
              <View key={p.id} style={[styles.playerRow, { backgroundColor: colors.surface }]}>
                <StatusDot color={colors.avatarColors[i % colors.avatarColors.length]} size="md" />
                <Text style={[styles.playerName, { color: colors.text }, p.userId === currentUserId && { fontWeight: '700', color: colors.primary }]}>
                  {p.userName}{p.userId === currentUserId ? ' (나)' : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Action buttons with scale press */}
        <View style={styles.actions}>
          <AnimatedPressable
            style={[styles.extendButton, { backgroundColor: colors.primary, ...shadows.colored(colors.primary) }, extendPress.animatedStyle]}
            onPress={() => {
              haptics.medium();
              onExtend();
            }}
            onPressIn={extendPress.onPressIn}
            onPressOut={extendPress.onPressOut}
          >
            <Icon name="timerPlus" size={16} color={palette.white} />
            <Text style={styles.extendText}>+15분 연장</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={[styles.completeButton, { backgroundColor: colors.danger, ...shadows.colored(colors.danger) }, completePress.animatedStyle]}
            onPress={() => {
              haptics.success();
              onComplete();
            }}
            onPressIn={completePress.onPressIn}
            onPressOut={completePress.onPressOut}
          >
            <Text style={styles.completeText}>{Strings.turn.complete}</Text>
          </AnimatedPressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  headerBand: {
    paddingVertical: spacing.mlg,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: alpha(palette.white, 0.25),
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
    borderRadius: radius.banner,
    gap: spacing.sm - 2,
  },
  liveText: {
    ...typography.overline,
    fontWeight: '800',
    color: palette.white,
    letterSpacing: 1,
  },
  label: {
    color: palette.white,
    fontSize: 17,
    fontWeight: '800',
  },
  body: {
    padding: spacing.xxl,
  },
  courtName: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  timerSection: {
    marginBottom: spacing.sm,
  },
  playersSectionTitle: {
    ...typography.overline,
    marginBottom: spacing.smd,
  },
  playersSection: {
    marginBottom: spacing.xl,
  },
  playersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.smd,
    borderRadius: radius.xxl,
    padding: spacing.mlg,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.banner,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  extendButton: {
    borderRadius: radius.xxl,
    paddingVertical: 18,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  extendText: {
    color: palette.white,
    ...typography.subtitle1,
  },
  completeButton: {
    borderRadius: radius.xxl,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  completeText: {
    color: palette.white,
    fontSize: 18,
    fontWeight: '700',
  },
});
