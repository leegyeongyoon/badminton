import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { StatusDot } from '../ui/StatusDot';
import { SwipeableCard } from '../ui/SwipeableCard';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius, createShadow } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Strings } from '../../constants/strings';
import { useScalePress, useFadeIn } from '../../utils/animations';

interface Player {
  id: string;
  userId: string;
  userName: string;
}

interface WaitingTurnCardProps {
  courtName: string;
  position: number;
  players: Player[];
  currentUserId?: string;
  onCancel: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function WaitingTurnCard({ courtName, position, players, currentUserId, onCancel }: WaitingTurnCardProps) {
  const { colors, shadows } = useTheme();
  const fadeInStyle = useFadeIn();
  const cancelPress = useScalePress(0.96);

  return (
    <SwipeableCard
      leftAction={{
        label: '취소',
        icon: 'cancel',
        color: colors.danger,
        onPress: onCancel,
      }}
    >
    <Animated.View style={[styles.card, { backgroundColor: colors.surface, ...createShadow(4, 10, 0.12, 4, colors.warning) }, fadeInStyle]}>
      {/* Thick amber accent band */}
      <View style={[styles.accentBand, { backgroundColor: colors.warning }]} />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <StatusDot color={colors.warning} size="lg" />
          <Text style={[styles.label, { color: colors.warning }]}>{Strings.turn.status.WAITING}</Text>
        </View>
        {/* Position badge */}
        <View style={[styles.positionBadge, { backgroundColor: colors.warning }]}>
          <Text style={styles.positionNumber}>{position}</Text>
          <Text style={styles.positionSuffix}>번째</Text>
        </View>
      </View>

      <View style={styles.body}>
        {/* Hero position number */}
        <View style={styles.heroSection}>
          <View style={[styles.heroCircle, { backgroundColor: alpha(colors.warning, 0.12), borderColor: alpha(colors.warning, 0.3) }]}>
            <Text style={[styles.heroNumber, { color: colors.warning }]}>{position}</Text>
          </View>
          <Text style={[styles.courtName, { color: colors.text }]}>{courtName}</Text>
        </View>

        {/* Next-up or estimated wait info card */}
        {position === 1 ? (
          <View style={[styles.nextUpCard, { backgroundColor: colors.primaryLight }]}>
            <Icon name="target" size={22} color={colors.primary} />
            <View>
              <Text style={[styles.nextUpText, { color: colors.primary }]}>{Strings.activity.nextTurn}</Text>
              <Text style={[styles.nextUpHint, { color: alpha(colors.primary, 0.7) }]}>곧 시작됩니다</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.estimatedWaitCard, { backgroundColor: colors.warningLight, borderColor: alpha(colors.warning, 0.25) }]}>
            <Text style={styles.estimatedWaitLabel}>{Strings.activity.estimatedWait}</Text>
            <Text style={styles.estimatedWaitValue}>
              약 {(position - 1) * 15}~{(position - 1) * 25}분
            </Text>
          </View>
        )}

        {/* Player chips in horizontal scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.playersScroll}
          style={styles.playersContainer}
        >
          {players.map((p, i) => (
            <View
              key={p.id}
              style={[
                styles.playerChip,
                { backgroundColor: colors.background },
                p.userId === currentUserId && { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: alpha(colors.primary, 0.2) },
              ]}
            >
              <StatusDot color={colors.avatarColors[i % colors.avatarColors.length]} size="sm" />
              <Text style={[styles.playerName, { color: colors.text }, p.userId === currentUserId && { fontWeight: '700', color: colors.primary }]}>
                {p.userName}{p.userId === currentUserId ? ' (나)' : ''}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* Cancel button with scale press */}
        <AnimatedPressable
          style={[styles.cancelButton, { backgroundColor: colors.warning, ...createShadow(4, 6, 0.2, 3, colors.warning) }, cancelPress.animatedStyle]}
          onPress={onCancel}
          onPressIn={cancelPress.onPressIn}
          onPressOut={cancelPress.onPressOut}
        >
          <Text style={styles.cancelButtonText}>{Strings.turn.cancel}</Text>
        </AnimatedPressable>
      </View>
    </Animated.View>
    </SwipeableCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  accentBand: {
    height: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.button,
  },
  positionBadge: {
    paddingHorizontal: spacing.mlg,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  positionNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: palette.white,
  },
  positionSuffix: {
    ...typography.buttonSm,
    fontWeight: '600',
    color: palette.white,
  },
  body: {
    padding: spacing.xl,
    paddingTop: spacing.xs,
  },
  // Hero position display
  heroSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.smd,
  },
  heroNumber: {
    fontSize: 32,
    fontWeight: '900',
    ...typography.tabular,
  },
  courtName: {
    fontSize: 22,
    fontWeight: '700',
  },
  // Next up card
  nextUpCard: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mlg,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
  },
  nextUpText: {
    ...typography.button,
  },
  nextUpHint: {
    ...typography.caption,
    marginTop: 2,
  },
  // Estimated wait card (more prominent)
  estimatedWaitCard: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
  },
  estimatedWaitLabel: {
    ...typography.overline,
    color: palette.amber800,
    marginBottom: spacing.sm,
  },
  estimatedWaitValue: {
    fontSize: 28,
    color: palette.amber800,
    fontWeight: '800',
    ...typography.tabular,
  },
  // Player chips in horizontal scroll
  playersContainer: {
    marginBottom: spacing.lg,
  },
  playersScroll: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.banner,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Cancel button
  cancelButton: {
    borderRadius: radius.xxl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: palette.white,
    ...typography.subtitle1,
  },
});
