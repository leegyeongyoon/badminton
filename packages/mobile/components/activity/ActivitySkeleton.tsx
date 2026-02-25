import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonRect, SkeletonLine, SkeletonGroup } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';

/**
 * Full-page skeleton for the activity tab.
 * Shows: GameStatsHeader pills, summary card, section cards, and history placeholders.
 */
export function ActivitySkeleton() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* GameStatsHeader - 3 pill skeletons */}
      <View style={styles.pillRow}>
        <SkeletonRect width={100} height={36} borderRadius={radius.pill} delay={0} />
        <SkeletonRect width={100} height={36} borderRadius={radius.pill} delay={60} />
        <SkeletonRect width={100} height={36} borderRadius={radius.pill} delay={120} />
      </View>

      {/* Summary card */}
      <View style={[styles.summaryCard, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="30%" height={20} delay={160} />
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <SkeletonRect width={40} height={28} borderRadius={radius.md} delay={200} />
            <SkeletonLine width={48} height={12} delay={240} />
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <SkeletonRect width={40} height={28} borderRadius={radius.md} delay={280} />
            <SkeletonLine width={48} height={12} delay={320} />
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <SkeletonRect width={40} height={28} borderRadius={radius.md} delay={360} />
            <SkeletonLine width={48} height={12} delay={400} />
          </View>
        </View>
      </View>

      {/* Section header skeleton */}
      <View style={styles.sectionHeader}>
        <SkeletonLine width="25%" height={14} delay={440} />
      </View>

      {/* Current status card */}
      <SkeletonGroup style={[styles.statusCard, { backgroundColor: colors.surface }, shadows.md]} staggerDelay={80}>
        <View style={styles.statusRow}>
          <SkeletonRect width={52} height={52} borderRadius={radius.xl} />
          <View style={styles.statusLines}>
            <SkeletonLine width="60%" height={16} />
            <SkeletonLine width="80%" height={12} />
          </View>
        </View>
        <SkeletonRect width="100%" height={8} borderRadius={4} />
        <SkeletonRect width="100%" height={36} borderRadius={radius.lg} />
      </SkeletonGroup>

      {/* Divider */}
      <View style={[styles.divider, { backgroundColor: colors.divider }]} />

      {/* Today history section header */}
      <View style={styles.sectionHeader}>
        <SkeletonLine width="20%" height={14} delay={680} />
      </View>

      {/* History card placeholders */}
      <SkeletonGroup style={styles.historyList} staggerDelay={60}>
        <SkeletonRect width="100%" height={60} borderRadius={radius.card} />
        <SkeletonRect width="100%" height={60} borderRadius={radius.card} />
        <SkeletonRect width="100%" height={60} borderRadius={radius.card} />
      </SkeletonGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxxl,
  },
  pillRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  summaryCard: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    gap: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  sectionHeader: {
    marginBottom: spacing.md,
  },
  statusCard: {
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusLines: {
    flex: 1,
    gap: spacing.sm,
  },
  divider: {
    height: 1,
    marginVertical: spacing.xl,
  },
  historyList: {
    gap: spacing.sm,
  },
});
