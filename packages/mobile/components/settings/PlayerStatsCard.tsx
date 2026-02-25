import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { Icon, IconName } from '../ui/Icon';
import { MiniBarChart } from '../charts/MiniBarChart';
import { GameTypeDonut } from '../charts/GameTypeDonut';
import { Skeleton, SkeletonLine } from '../ui/Skeleton';
import { typography, radius, spacing } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { springPresets } from '../../utils/animations';

// ─── Types ───────────────────────────────────────────────────
interface PlayerStats {
  totalGames: number;
  thisMonthGames: number;
  noShowCount: number;
  activePenalties: number;
}

interface GameTypeData {
  label: string;
  value: number;
  color: string;
}

interface PlayerStatsCardProps {
  stats: PlayerStats | null;
  weeklyData?: number[];
  gameTypeData?: GameTypeData[];
  loading?: boolean;
}

interface StatBoxConfig {
  icon: IconName;
  label: string;
  value: number;
  color: string;
  tintBg?: string;
}

// ─── StatBox Component ───────────────────────────────────────
function StatBox({ icon, label, value, color, tintBg }: StatBoxConfig) {
  const { colors } = useTheme();
  const scale = useSharedValue(0.8);

  useEffect(() => {
    scale.value = withSpring(1, springPresets.gentle);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.statBox,
        { backgroundColor: tintBg || colors.surface, borderColor: colors.divider },
        animatedStyle,
      ]}
    >
      <Icon name={icon} size={20} color={color} />
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </Animated.View>
  );
}

// ─── StatBox Skeleton ────────────────────────────────────────
function StatBoxSkeleton() {
  const { colors } = useTheme();

  return (
    <View style={[styles.statBox, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
      <Skeleton width={20} height={20} borderRadius={10} />
      <SkeletonLine width={40} height={24} />
      <SkeletonLine width={48} height={12} />
    </View>
  );
}

// ─── Chart Section Wrapper ───────────────────────────────────
function ChartSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.chartSection}>
      <View style={[styles.chartDivider, { backgroundColor: colors.divider }]} />
      <Text style={[styles.chartTitle, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

// ─── Skeleton Card ───────────────────────────────────────────
function PlayerStatsCardSkeleton() {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
      <SkeletonLine width={80} height={18} style={{ marginBottom: spacing.md }} />
      <View style={styles.grid}>
        <View style={styles.row}>
          <StatBoxSkeleton />
          <StatBoxSkeleton />
        </View>
        <View style={styles.row}>
          <StatBoxSkeleton />
          <StatBoxSkeleton />
        </View>
      </View>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────
export function PlayerStatsCard({
  stats,
  weeklyData,
  gameTypeData,
  loading,
}: PlayerStatsCardProps) {
  const { colors, shadows } = useTheme();

  if (loading) return <PlayerStatsCardSkeleton />;
  if (!stats) return null;

  const noShowTint = stats.noShowCount > 0
    ? alpha(colors.danger, 0.05)
    : undefined;

  const penaltyTint = stats.activePenalties > 0
    ? alpha(colors.warning, 0.05)
    : undefined;

  const weeklyLabels = ['월', '화', '수', '목', '금', '토', '일'];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
      <Text style={[styles.title, { color: colors.text }]}>활동 통계</Text>
      <View style={styles.grid}>
        {/* Row 1 */}
        <View style={styles.row}>
          <StatBox
            icon="trophy"
            label="총 게임"
            value={stats.totalGames}
            color={colors.primary}
          />
          <StatBox
            icon="calendar"
            label="이번 달"
            value={stats.thisMonthGames}
            color={colors.secondary}
          />
        </View>
        {/* Row 2 */}
        <View style={styles.row}>
          <StatBox
            icon="error"
            label="노쇼"
            value={stats.noShowCount}
            color={colors.danger}
            tintBg={noShowTint}
          />
          <StatBox
            icon="warning"
            label="활성 패널티"
            value={stats.activePenalties}
            color={colors.warning}
            tintBg={penaltyTint}
          />
        </View>
      </View>

      {/* Weekly Games Chart */}
      {weeklyData && weeklyData.length > 0 && (
        <ChartSection title="주간 게임">
          <MiniBarChart
            data={weeklyData}
            labels={weeklyLabels}
            color={colors.primary}
            height={64}
          />
        </ChartSection>
      )}

      {/* Game Type Distribution */}
      {gameTypeData && gameTypeData.length > 0 && (
        <ChartSection title="게임 유형">
          <GameTypeDonut data={gameTypeData} />
        </ChartSection>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.subtitle1,
    marginBottom: spacing.md,
  },
  grid: {
    gap: spacing.smd,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.smd,
  },
  statBox: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
  },
  statValue: {
    ...typography.h2,
  },
  statLabel: {
    ...typography.caption,
  },
  // Chart sections
  chartSection: {
    marginTop: spacing.md,
  },
  chartDivider: {
    height: 1,
    marginBottom: spacing.md,
  },
  chartTitle: {
    ...typography.caption,
    marginBottom: spacing.smd,
  },
});
