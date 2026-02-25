import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';

interface TodayStatsGridProps {
  stats: {
    totalGames: number;
    avgWaitMinutes: number;
    peakPlayers: number;
  } | null;
}

export function TodayStatsGrid({ stats }: TodayStatsGridProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();
  const fadeStyle = useFadeIn();

  if (!stats) return null;

  return (
    <Animated.View style={[styles.section, { marginBottom: spacing.xxl }, fadeStyle]}>
      <Text
        style={[
          typography.subtitle1,
          {
            fontWeight: '800',
            color: colors.text,
            marginBottom: spacing.md,
            letterSpacing: 0.3,
          },
        ]}
      >
        {Strings.admin.todayStats}
      </Text>
      <View style={[styles.todayStatsGrid, { gap: spacing.smd }]}>
        <View
          style={[
            styles.todayStatCard,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.lg,
              ...shadows.md,
            },
          ]}
        >
          <View
            style={[
              styles.todayStatIconBg,
              {
                backgroundColor: colors.primaryLight,
                borderRadius: radius.xl,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Icon name="court" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.todayStatValue, { color: colors.text }]}>
            {stats.totalGames}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            {Strings.admin.totalGames}
          </Text>
        </View>

        <View
          style={[
            styles.todayStatCard,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.lg,
              ...shadows.md,
            },
          ]}
        >
          <View
            style={[
              styles.todayStatIconBg,
              {
                backgroundColor: colors.warningLight,
                borderRadius: radius.xl,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Icon name="timer" size={20} color={colors.warning} />
          </View>
          <Text style={[styles.todayStatValue, { color: colors.text }]}>
            {stats.avgWaitMinutes > 0 ? `${stats.avgWaitMinutes}분` : '-'}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            {Strings.admin.avgWaitTime}
          </Text>
        </View>

        <View
          style={[
            styles.todayStatCard,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.lg,
              ...shadows.md,
            },
          ]}
        >
          <View
            style={[
              styles.todayStatIconBg,
              {
                backgroundColor: colors.secondaryLight,
                borderRadius: radius.xl,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Icon name="people" size={20} color={colors.secondary} />
          </View>
          <Text style={[styles.todayStatValue, { color: colors.text }]}>
            {stats.peakPlayers}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.textSecondary, marginTop: spacing.xs },
            ]}
          >
            {Strings.admin.peakPlayers}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {},
  todayStatsGrid: {
    flexDirection: 'row',
  },
  todayStatCard: {
    flex: 1,
    alignItems: 'center',
  },
  todayStatIconBg: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayStatValue: {
    fontSize: 24,
    fontWeight: '800',
  },
});
