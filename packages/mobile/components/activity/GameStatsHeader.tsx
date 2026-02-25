/**
 * GameStatsHeader - Compact stats summary row at top of Activity tab.
 * Shows today's games, total games, and consecutive days as pill-style cards.
 * Supports a loading state with skeleton pills.
 */
import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { Icon, type IconName } from '../ui/Icon';
import { Skeleton, SkeletonLine } from '../ui/Skeleton';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { useFadeIn } from '../../utils/animations';

// ─── Types ───────────────────────────────────────────────────
interface GameStatsHeaderProps {
  todayGames: number;
  totalGames: number;
  consecutiveDays: number;
  loading?: boolean;
  style?: ViewStyle;
}

interface StatPillConfig {
  icon: IconName;
  value: number;
  label: string;
  accentColor: string;
}

// ─── StatPill Component ──────────────────────────────────────
function StatPill({
  icon,
  value,
  label,
  accentColor,
}: StatPillConfig) {
  const { colors, shadows } = useTheme();

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
        shadows.sm,
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: alpha(accentColor, 0.1) },
        ]}
      >
        <Icon name={icon} size={14} color={accentColor} />
      </View>
      <Text style={[styles.pillValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.pillLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

// ─── Skeleton Pill ───────────────────────────────────────────
function SkeletonPill() {
  const { colors, shadows } = useTheme();

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
        shadows.sm,
      ]}
    >
      <Skeleton width={28} height={28} borderRadius={14} />
      <SkeletonLine width={32} height={18} />
      <SkeletonLine width={40} height={12} />
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────
export function GameStatsHeader({
  todayGames,
  totalGames,
  consecutiveDays,
  loading,
  style,
}: GameStatsHeaderProps) {
  const { colors } = useTheme();
  const fadeInStyle = useFadeIn();

  if (loading) {
    return (
      <Animated.View style={[styles.container, style, fadeInStyle]}>
        <SkeletonPill />
        <SkeletonPill />
        <SkeletonPill />
      </Animated.View>
    );
  }

  const pills: StatPillConfig[] = [
    {
      icon: 'trophy',
      value: todayGames,
      label: '오늘',
      accentColor: colors.primary,
    },
    {
      icon: 'stats',
      value: totalGames,
      label: '총 게임',
      accentColor: colors.secondary,
    },
    {
      icon: 'calendar',
      value: consecutiveDays,
      label: '연속일',
      accentColor: colors.warning,
    },
  ];

  return (
    <Animated.View style={[styles.container, style, fadeInStyle]}>
      {pills.map((pill) => (
        <StatPill key={pill.label} {...pill} />
      ))}
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  pill: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: spacing.xs,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillValue: {
    ...typography.subtitle1,
  },
  pillLabel: {
    ...typography.caption,
  },
});
