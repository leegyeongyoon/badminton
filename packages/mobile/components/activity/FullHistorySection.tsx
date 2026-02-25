import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { timingPresets } from '../../utils/animations';

interface FullHistorySectionProps {
  showHistory: boolean;
  history: any[];
  historyLoading: boolean;
  hasMoreHistory: boolean;
  onToggle: () => void;
  onLoadMore: () => void;
}

/** Group history items by date string (e.g. "2월 24일 (월)"). */
function groupByDate(history: any[]): { date: string; items: any[] }[] {
  const map = new Map<string, any[]>();
  for (const game of history) {
    const raw = game.completedAt || game.startedAt || game.createdAt;
    const label = raw
      ? new Date(raw).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })
      : '-';
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(game);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

export function FullHistorySection({ showHistory, history, historyLoading, hasMoreHistory, onToggle, onLoadMore }: FullHistorySectionProps) {
  const { colors, shadows } = useTheme();

  // Animated expand / collapse
  const expandProgress = useSharedValue(showHistory ? 1 : 0);
  const chevronRotation = useSharedValue(showHistory ? 180 : 0);

  useEffect(() => {
    expandProgress.value = withTiming(showHistory ? 1 : 0, timingPresets.normal);
    chevronRotation.value = withTiming(showHistory ? 180 : 0, timingPresets.normal);
  }, [showHistory]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: expandProgress.value,
    maxHeight: expandProgress.value === 0 ? 0 : undefined,
    overflow: 'hidden' as const,
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const grouped = groupByDate(history);

  return (
    <View style={styles.section}>
      <TouchableOpacity style={[styles.toggleButton, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]} onPress={onToggle} activeOpacity={0.8}>
        <Icon name={showHistory ? 'folderOpen' : 'folder'} size={16} color={colors.textSecondary} />
        <Text style={[styles.toggleText, { color: colors.textSecondary }]}>{showHistory ? '전체 히스토리 닫기' : '전체 히스토리 보기'}</Text>
        <Animated.View style={chevronStyle}>
          <Icon name="chevronDown" size={14} color={colors.textLight} />
        </Animated.View>
      </TouchableOpacity>

      {showHistory && (
        <Animated.View style={[styles.container, contentStyle]}>
          <Text style={[styles.title, { color: colors.text }]}>전체 히스토리</Text>

          {history.length === 0 && !historyLoading && (
            <View style={styles.emptyWrap}>
              <Icon name="history" size={32} color={colors.textLight} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>게임 기록이 없습니다</Text>
            </View>
          )}

          {grouped.map((group) => (
            <View key={group.date} style={styles.dateGroup}>
              <Text style={[styles.dateHeader, { color: colors.textSecondary }]}>{group.date}</Text>
              {group.items.map((game: any, idx: number) => {
                const duration = game.startedAt && game.completedAt
                  ? Math.round((new Date(game.completedAt).getTime() - new Date(game.startedAt).getTime()) / 60000)
                  : null;
                return (
                  <View key={game.id || idx} style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
                    <View style={styles.top}>
                      {game.completedAt && (
                        <Text style={[styles.time, { color: colors.textSecondary }]}>
                          {new Date(game.completedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )}
                      {game.gameType && (
                        <Badge
                          label={Strings.court.gameType[game.gameType as keyof typeof Strings.court.gameType] || game.gameType}
                          variant="filled"
                          color="secondary"
                          size="sm"
                        />
                      )}
                      {duration != null && (
                        <Badge label={`${duration}분`} variant="filled" color="primary" size="sm" />
                      )}
                    </View>
                    <Text style={[styles.courtName, { color: colors.text }]}>{game.courtName || '-'}</Text>
                    <Text style={[styles.players, { color: colors.textSecondary }]}>{(game.players || []).map((p: any) => p.userName).join(', ') || '-'}</Text>
                  </View>
                );
              })}
            </View>
          ))}

          {hasMoreHistory && history.length > 0 && (
            <TouchableOpacity style={[styles.loadMore, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={onLoadMore} disabled={historyLoading} activeOpacity={0.8}>
              {historyLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.loadMoreText, { color: colors.primary }]}>더 보기</Text>
              )}
            </TouchableOpacity>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, marginBottom: spacing.xl },
  toggleButton: {
    borderRadius: radius.xxl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smd,
    borderWidth: 1,
  },
  toggleText: { ...typography.subtitle2 },
  container: { marginTop: spacing.lg },
  title: { ...typography.h3, marginBottom: spacing.mlg },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyText: { ...typography.body2 },
  dateGroup: { marginBottom: spacing.lg },
  dateHeader: {
    ...typography.subtitle2,
    marginBottom: spacing.sm,
    paddingLeft: spacing.xs,
  },
  card: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  time: {
    ...typography.caption,
    fontWeight: '600',
    ...typography.tabular,
  },
  courtName: { ...typography.subtitle1, marginBottom: spacing.xs },
  players: { ...typography.body2 },
  loadMore: {
    borderRadius: radius.xxl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: spacing.xs,
  },
  loadMoreText: { ...typography.button },
});
