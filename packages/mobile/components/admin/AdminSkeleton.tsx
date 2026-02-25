import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonRect, SkeletonLine, SkeletonGroup } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';

/**
 * Full-page skeleton for the admin dashboard.
 * Shows: header, quick actions, session control, capacity, stats grid, chart areas, court list.
 */
export function AdminSkeleton() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* AdminHeader skeleton */}
      <View style={styles.headerSection}>
        <SkeletonLine width="55%" height={22} delay={0} />
        <SkeletonLine width="35%" height={14} delay={40} style={{ marginTop: spacing.sm }} />
      </View>

      {/* QuickActionsBar skeleton */}
      <View style={styles.actionsRow}>
        <SkeletonRect width="48%" height={44} borderRadius={radius.xl} delay={80} />
        <SkeletonRect width="48%" height={44} borderRadius={radius.xl} delay={120} />
      </View>

      {/* SessionControl skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="25%" height={14} delay={160} />
        <SkeletonGroup style={styles.sessionInner} staggerDelay={40}>
          <SkeletonLine width="70%" height={16} />
          <SkeletonLine width="50%" height={13} />
          <SkeletonRect width="100%" height={42} borderRadius={radius.lg} />
        </SkeletonGroup>
      </View>

      {/* CapacityOverview skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="25%" height={14} delay={320} />
        <View style={styles.capacityGrid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.capacityItem}>
              <SkeletonRect width={44} height={28} borderRadius={radius.md} delay={360 + i * 40} />
              <SkeletonLine width={52} height={11} delay={380 + i * 40} />
            </View>
          ))}
        </View>
      </View>

      {/* TodayStatsGrid skeleton - 4 stat cards */}
      <View style={styles.statsSection}>
        <SkeletonLine width="25%" height={14} delay={520} />
        <View style={styles.statsGrid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.statCard, { backgroundColor: colors.surface }, shadows.sm]}>
              <SkeletonLine width="70%" height={11} delay={560 + i * 40} />
              <SkeletonLine width="45%" height={22} delay={580 + i * 40} style={{ marginTop: spacing.sm }} />
            </View>
          ))}
        </View>
      </View>

      {/* Chart areas skeleton */}
      <View style={styles.chartsSection}>
        <SkeletonLine width="25%" height={14} delay={720} />
        <SkeletonRect width="100%" height={140} borderRadius={radius.card} delay={760} />
        <SkeletonRect width="100%" height={120} borderRadius={radius.card} delay={820} />
      </View>

      {/* Court management skeleton */}
      <View style={styles.courtsSection}>
        <SkeletonLine width="30%" height={14} delay={880} />
        <SkeletonGroup style={styles.courtList} staggerDelay={60}>
          <SkeletonRect width="100%" height={64} borderRadius={radius.card} />
          <SkeletonRect width="100%" height={64} borderRadius={radius.card} />
          <SkeletonRect width="100%" height={64} borderRadius={radius.card} />
        </SkeletonGroup>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxxxl,
    gap: spacing.xxl,
  },
  headerSection: {
    paddingVertical: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  card: {
    borderRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sessionInner: {
    gap: spacing.md,
  },
  capacityGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  capacityItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statsSection: {
    gap: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  chartsSection: {
    gap: spacing.md,
  },
  courtsSection: {
    gap: spacing.md,
  },
  courtList: {
    gap: spacing.sm,
  },
});
