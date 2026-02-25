import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SkeletonRect, SkeletonLine, SkeletonCircle, SkeletonGroup } from '../ui/Skeleton';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';

/**
 * Full-page skeleton for the settings tab.
 * Shows: UserProfileCard, PlayerStatsCard, FacilitySection, ClubsSection, MenuSection.
 */
export function SettingsSkeleton() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* UserProfileCard skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <View style={styles.profileRow}>
          <SkeletonCircle size={56} delay={0} />
          <View style={styles.profileLines}>
            <SkeletonLine width="50%" height={18} delay={40} />
            <SkeletonLine width="35%" height={13} delay={80} />
          </View>
        </View>
        <SkeletonRect width="100%" height={36} borderRadius={radius.lg} delay={120} style={{ marginTop: spacing.md }} />
      </View>

      {/* PlayerStatsCard skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="35%" height={16} delay={160} />
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <SkeletonRect width={48} height={32} borderRadius={radius.md} delay={200} />
            <SkeletonLine width={56} height={11} delay={240} />
          </View>
          <View style={styles.statBox}>
            <SkeletonRect width={48} height={32} borderRadius={radius.md} delay={260} />
            <SkeletonLine width={56} height={11} delay={300} />
          </View>
          <View style={styles.statBox}>
            <SkeletonRect width={48} height={32} borderRadius={radius.md} delay={320} />
            <SkeletonLine width={56} height={11} delay={360} />
          </View>
          <View style={styles.statBox}>
            <SkeletonRect width={48} height={32} borderRadius={radius.md} delay={380} />
            <SkeletonLine width={56} height={11} delay={420} />
          </View>
        </View>
        {/* Weekly chart placeholder */}
        <SkeletonRect width="100%" height={80} borderRadius={radius.lg} delay={440} />
        {/* Game type donut placeholder */}
        <View style={styles.donutRow}>
          <SkeletonCircle size={60} delay={480} />
          <View style={styles.donutLegend}>
            <SkeletonLine width={64} height={12} delay={520} />
            <SkeletonLine width={48} height={12} delay={560} />
          </View>
        </View>
      </View>

      {/* FacilitySection skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="25%" height={13} delay={580} />
        <SkeletonGroup style={styles.menuItems} staggerDelay={40}>
          <SkeletonLine width="70%" height={16} />
          <SkeletonLine width="55%" height={16} />
        </SkeletonGroup>
      </View>

      {/* ClubsSection skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="20%" height={13} delay={680} />
        <SkeletonGroup style={styles.menuItems} staggerDelay={40}>
          <SkeletonLine width="65%" height={16} />
          <SkeletonLine width="45%" height={16} />
        </SkeletonGroup>
      </View>

      {/* MenuSection skeleton */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
        <SkeletonLine width="30%" height={13} delay={760} />
        <SkeletonGroup style={styles.menuItems} staggerDelay={40}>
          <SkeletonLine width="75%" height={16} />
          <SkeletonLine width="60%" height={16} />
          <SkeletonLine width="50%" height={16} />
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
    gap: spacing.lg,
  },
  card: {
    borderRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileLines: {
    flex: 1,
    gap: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  donutLegend: {
    flex: 1,
    gap: spacing.sm,
  },
  menuItems: {
    gap: spacing.md,
  },
});
