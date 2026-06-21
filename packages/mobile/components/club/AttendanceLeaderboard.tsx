import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useAuthStore } from '../../store/authStore';
import { typography, spacing, radius, palette } from '../../constants/theme';
import { getSkillMeta } from '../../constants/skill';
import {
  clubApi,
  type AttendancePeriod,
  type AttendanceEntry,
  type AttendanceLeaderboard as Leaderboard,
} from '../../services/club';
import { Skeleton, SkeletonGroup } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { SectionHeader } from '../ui/SectionHeader';

interface AttendanceLeaderboardProps {
  clubId: string;
}

const PERIODS: { key: AttendancePeriod; label: string }[] = [
  { key: 'month', label: '이번 달' },
  { key: 'year', label: '올해' },
  { key: 'all', label: '전체' },
];

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Distinct accent colors for the top-3 rank badges.
const RANK_COLORS: Record<number, string> = {
  1: palette.amber500,
  2: palette.slate400,
  3: palette.amber700,
};

export function AttendanceLeaderboard({ clubId }: AttendanceLeaderboardProps) {
  const { colors, shadows } = useTheme();
  const { user } = useAuthStore();

  const [period, setPeriod] = useState<AttendancePeriod>('month');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(
    async (p: AttendancePeriod) => {
      if (!clubId) return;
      setLoading(true);
      setErrored(false);
      try {
        const { data: res } = await clubApi.getAttendanceLeaderboard(clubId, p);
        setData(res);
      } catch {
        setErrored(true);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [clubId],
  );

  // Refetch whenever the club or the selected period changes.
  useEffect(() => {
    load(period);
  }, [load, period]);

  const me = data?.me ?? null;
  const entries = data?.entries ?? [];

  return (
    <View style={styles.container}>
      <SectionHeader title="🏆 출석왕" />

      {/* Period segmented toggle */}
      <View style={[styles.segment, { backgroundColor: colors.surface2 }]}>
        {PERIODS.map((p) => {
          const active = p.key === period;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPeriod(p.key)}
              style={({ pressed }) => [
                styles.segmentBtn,
                active && [styles.segmentBtnActive, { backgroundColor: colors.surface }, shadows.sm],
                pressed && !active && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? colors.primary : colors.textSecondary },
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* My attendance pill */}
      {!loading && me && (
        <View style={[styles.mePill, { backgroundColor: colors.primaryBg, borderColor: colors.primaryLight }]}>
          <Text style={[styles.mePillLabel, { color: colors.primary }]}>내 출석</Text>
          <Text style={[styles.mePillValue, { color: colors.primary }]}>
            {me.attendanceCount}회 · {me.rank}위
          </Text>
        </View>
      )}

      {/* Body */}
      {loading ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <SkeletonGroup>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width={28} height={28} borderRadius={radius.full} />
                <Skeleton width="55%" height={16} borderRadius={radius.sm} style={{ flex: 1 }} />
                <Skeleton width={44} height={16} borderRadius={radius.sm} />
              </View>
            ))}
          </SkeletonGroup>
        </View>
      ) : errored ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <EmptyState
            icon="warning"
            compact
            title="출석 기록을 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요"
            action={{ label: '다시 시도', onPress: () => load(period) }}
          />
        </View>
      ) : entries.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <EmptyState
            icon="trophy"
            compact
            title="아직 출석 기록이 없어요"
            description="정모에 참여하면 출석왕 순위가 채워져요"
          />
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          {entries.map((entry, idx) => (
            <AttendanceRow
              key={entry.userId}
              entry={entry}
              isMe={entry.userId === user?.id}
              isLast={idx === entries.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

interface AttendanceRowProps {
  entry: AttendanceEntry;
  isMe: boolean;
  isLast: boolean;
}

function AttendanceRow({ entry, isMe, isLast }: AttendanceRowProps) {
  const { colors } = useTheme();
  const skill = getSkillMeta(entry.skillLevel);
  const medal = MEDALS[entry.rank];
  const rankColor = RANK_COLORS[entry.rank];

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
        isMe && { backgroundColor: colors.primaryBg },
      ]}
    >
      {/* Rank / medal */}
      <View style={styles.rankWrap}>
        {medal ? (
          <Text style={styles.medal}>{medal}</Text>
        ) : (
          <View style={[styles.rankBadge, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.rankBadgeText, { color: colors.textSecondary }]}>{entry.rank}</Text>
          </View>
        )}
      </View>

      {/* Name + skill chip */}
      <View style={styles.nameWrap}>
        <View style={styles.nameRow}>
          <Text
            style={[styles.name, { color: colors.text }, isMe && { color: colors.primary }]}
            numberOfLines={1}
          >
            {entry.name}
          </Text>
          {isMe && <Text style={[styles.meTag, { color: colors.primary }]}>나</Text>}
        </View>
        {entry.skillLevel ? (
          <View style={styles.skillChip}>
            <View style={[styles.skillDot, { backgroundColor: skill.color }]} />
            <Text style={[styles.skillText, { color: skill.color }]}>
              {skill.level} · {skill.description}
            </Text>
          </View>
        ) : (
          <View style={styles.skillChip}>
            <Text style={[styles.skillText, { color: skill.color }]}>미설정</Text>
          </View>
        )}
      </View>

      {/* Attendance count */}
      <View style={styles.countWrap}>
        <Text
          style={[
            styles.count,
            typography.tabular,
            { color: rankColor || colors.text },
            isMe && !rankColor && { color: colors.primary },
          ]}
        >
          {entry.attendanceCount}
        </Text>
        <Text style={[styles.countUnit, { color: colors.textLight }]}>회</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },

  // Segmented toggle
  segment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: spacing.xs,
    marginBottom: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {},
  segmentText: {
    ...typography.subtitle2,
  },

  // My attendance pill
  mePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  mePillLabel: {
    ...typography.subtitle2,
  },
  mePillValue: {
    ...typography.subtitle1,
  },

  // Card
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
  },

  // Skeleton
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  rankWrap: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medal: {
    fontSize: 22,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    ...typography.subtitle2,
  },
  nameWrap: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.subtitle1,
    flexShrink: 1,
  },
  meTag: {
    ...typography.caption,
    fontWeight: '800',
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  skillDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  skillText: {
    ...typography.caption,
    fontWeight: '700',
  },
  countWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  count: {
    ...typography.h3,
  },
  countUnit: {
    ...typography.caption,
  },
});
