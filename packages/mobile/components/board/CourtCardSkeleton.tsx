import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { SkeletonLine, SkeletonCircle, SkeletonRect } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';
import { useStagger } from '../../utils/animations';

interface CourtCardSkeletonProps {
  index?: number;
}

/**
 * Skeleton placeholder that mirrors the CourtCard layout.
 * Renders inside the same 48%-width touchable wrapper the real card uses.
 * Accepts an `index` prop for staggered fade-in animation.
 */
export function CourtCardSkeleton({ index = 0 }: CourtCardSkeletonProps) {
  const { colors, shadows } = useTheme();
  const staggerStyle = useStagger(index);
  const baseDelay = index * 80;

  return (
    <Animated.View style={[styles.wrapper, staggerStyle]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.md]}>
        {/* Header row: status dot + court name + status badge */}
        <View style={styles.headerRow}>
          <View style={styles.nameRow}>
            <SkeletonCircle size={10} delay={baseDelay} />
            <SkeletonLine width="55%" height={18} delay={baseDelay + 40} />
          </View>
          <SkeletonRect width={48} height={22} borderRadius={radius.md} delay={baseDelay + 80} />
        </View>

        {/* Turn capacity indicator bar */}
        <View style={styles.turnIndicator}>
          <SkeletonRect width="80%" height={6} borderRadius={3} delay={baseDelay + 120} />
          <SkeletonLine width={24} height={12} delay={baseDelay + 160} />
        </View>

        {/* Playing section: avatars + player names */}
        <View style={styles.playingSection}>
          <View style={styles.playingHeader}>
            <SkeletonCircle size={6} delay={baseDelay + 200} />
            <SkeletonLine width={32} height={12} delay={baseDelay + 220} />
          </View>
          <View style={styles.avatarRow}>
            <SkeletonCircle size={30} delay={baseDelay + 260} />
            <SkeletonCircle size={30} delay={baseDelay + 300} />
            <SkeletonCircle size={30} delay={baseDelay + 340} />
          </View>
          <SkeletonLine width="60%" height={10} delay={baseDelay + 380} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    maxWidth: '48%',
    margin: spacing.xs,
  },
  card: {
    flex: 1,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: 1,
    overflow: 'hidden',
    gap: spacing.smd,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  turnIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playingSection: {
    marginTop: spacing.xs,
    paddingTop: spacing.smd,
    gap: spacing.sm,
  },
  playingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  avatarRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
