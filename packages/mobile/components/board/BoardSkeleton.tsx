import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonRect, SkeletonLine, SkeletonGroup } from '../ui/Skeleton';
import { CourtCardSkeleton } from './CourtCardSkeleton';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';

/**
 * Full-page skeleton for the board tab.
 * Shows: banner area, my status area, capacity bar, and 4 court card skeletons in a 2-column grid.
 */
export function BoardSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SkeletonGroup style={styles.headerGroup} staggerDelay={100}>
        {/* Banner skeleton */}
        <SkeletonRect width="100%" height={64} borderRadius={radius.card} />
        {/* My status skeleton */}
        <SkeletonRect width="100%" height={80} borderRadius={radius.card} />
        {/* Capacity bar */}
        <SkeletonRect width="100%" height={40} borderRadius={radius.xl} />
      </SkeletonGroup>

      {/* Section title skeleton */}
      <SkeletonLine width="30%" height={14} delay={300} style={{ marginBottom: spacing.md }} />

      {/* Court grid - 2 columns */}
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <CourtCardSkeleton key={i} index={i} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
  },
  headerGroup: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
