import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
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
  /**
   * When set, the list is collapsed to this many rows (e.g. top-3) with a
   * "전체 보기 / 접기" toggle. The "내 출석" pill is always shown so a member
   * outside the top rows can still see their rank. Omit to render every row.
   */
  maxRows?: number;
}

// 상단 세그먼트 프리셋. '월별'은 특정 월(YYYY-MM)을 고르는 모드로, 선택 시 아래에 월 칩이 뜬다.
const PRESETS = [
  { key: 'month' as const, label: '월별' },
  { key: 'year' as const, label: '올해' },
  { key: 'all' as const, label: '전체' },
];

// YYYY-MM 키 <-> 표시용 헬퍼.
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const isMonthKey = (p: string) => /^\d{4}-\d{2}$/.test(p);
// 최근 12개월(이번 달 → 과거) 키 목록.
function recentMonths(count = 12): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
}
// 칩 라벨: 이번 달은 '이번 달', 그 외엔 'YYYY.M'.
function monthLabel(key: string): string {
  const now = new Date();
  if (key === monthKey(now)) return '이번 달';
  const [y, m] = key.split('-');
  return `${y}.${Number(m)}`;
}

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Distinct accent colors for the top-3 rank badges.
const RANK_COLORS: Record<number, string> = {
  1: palette.amber500,
  2: palette.slate400,
  3: palette.amber700,
};

export function AttendanceLeaderboard({ clubId, maxRows }: AttendanceLeaderboardProps) {
  const { colors, shadows } = useTheme();
  const { user } = useAuthStore();

  // 기본값 = 이번 달(구체 월 키). '월별' 모드일 때 선택된 월을 그대로 period 로 쓴다.
  const months = useMemo(() => recentMonths(12), []);
  const [period, setPeriod] = useState<AttendancePeriod>(() => months[0]);
  const monthMode = isMonthKey(period as string);
  const [data, setData] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  // Collapsed (top-N) vs expanded (all rows) when `maxRows` is set.
  const [expanded, setExpanded] = useState(false);

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
    setExpanded(false); // collapse back to top-N when switching period
  }, [load, period]);

  const me = data?.me ?? null;
  const entries = data?.entries ?? [];
  // 서버는 빈 달에도 전원(0회)을 내려준다. 아무도 출석 안 했으면 '0회 순위' 대신
  // 안내를 띄운다(0회를 1위로 보여주는 이상한 화면 방지).
  const hasAny = entries.some((e) => e.attendanceCount > 0);
  // Collapse to top-N rows unless expanded (only when maxRows is provided).
  const collapsible = maxRows != null && entries.length > maxRows;
  const visibleEntries = collapsible && !expanded ? entries.slice(0, maxRows) : entries;

  return (
    <View style={styles.container}>
      <SectionHeader title="🏆 출석왕" />

      {/* Period segmented toggle — 월별 / 올해 / 전체 */}
      <View style={[styles.segment, { backgroundColor: colors.surface2 }]}>
        {PRESETS.map((p) => {
          const active = p.key === 'month' ? monthMode : p.key === period;
          return (
            <Pressable
              key={p.key}
              // '월별'을 누르면 최근 월(이번 달)로, 올해/전체는 그대로.
              onPress={() => setPeriod(p.key === 'month' ? months[0] : p.key)}
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

      {/* 월별 모드: 특정 월을 가로 스크롤로 선택 */}
      {monthMode && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.monthRow}
          style={styles.monthScroll}
        >
          {months.map((mk) => {
            const active = mk === period;
            return (
              <Pressable
                key={mk}
                onPress={() => setPeriod(mk)}
                style={({ pressed }) => [
                  styles.monthChip,
                  { borderColor: active ? colors.primary : colors.divider, backgroundColor: active ? colors.primaryBg : colors.surface },
                  pressed && !active && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.monthChipText, { color: active ? colors.primary : colors.textSecondary }]}>
                  {monthLabel(mk)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* My attendance pill — 집계가 의미 있을 때만(아무도 출석 안 한 달엔 숨김) */}
      {!loading && me && hasAny && (
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
      ) : entries.length === 0 || !hasAny ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          <EmptyState
            icon="trophy"
            compact
            title={monthMode ? '이 달엔 정모 기록이 없어요' : '아직 출석 기록이 없어요'}
            description={monthMode ? '위에서 다른 달을 골라보세요' : '정모에 참여하면 출석왕 순위가 채워져요'}
          />
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }, shadows.md]}>
          {visibleEntries.map((entry, idx) => (
            <AttendanceRow
              key={entry.userId}
              entry={entry}
              isMe={entry.userId === user?.id}
              isLast={idx === visibleEntries.length - 1 && !collapsible}
            />
          ))}
          {collapsible && (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              style={({ pressed }) => [
                styles.seeAll,
                { borderTopColor: colors.divider },
                pressed && { opacity: 0.6 },
              ]}
              accessibilityLabel={expanded ? '출석왕 접기' : '출석왕 전체 보기'}
            >
              <Text style={[styles.seeAllText, { color: colors.primary }]}>
                {expanded ? '접기' : `전체 보기 (${entries.length})`}
              </Text>
            </Pressable>
          )}
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

  // 월 선택 가로 스크롤
  monthScroll: {
    marginBottom: spacing.md,
  },
  monthRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  monthChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  monthChipText: {
    ...typography.caption,
    fontWeight: '700',
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

  // 전체 보기 / 접기 toggle (collapsed top-N mode)
  seeAll: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  seeAllText: {
    ...typography.subtitle2,
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
