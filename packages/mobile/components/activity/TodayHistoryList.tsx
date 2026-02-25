import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/Badge';
import { SectionHeader } from '../ui/SectionHeader';
import { SwipeableCard } from '../ui/SwipeableCard';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { useStagger } from '../../utils/animations';

interface GameHistoryItem {
  id: string;
  courtName: string;
  status: string;
  gameType: string;
  startedAt: string | null;
  completedAt: string | null;
  players: { userName: string }[];
}

interface TodayHistoryListProps {
  games: GameHistoryItem[];
  onRequeue: (gameId: string) => void;
}

function HistoryItem({ game, index, onRequeue }: { game: GameHistoryItem; index: number; onRequeue: (gameId: string) => void }) {
  const { colors, shadows } = useTheme();
  const staggerStyle = useStagger(index);

  const duration = game.startedAt && game.completedAt
    ? Math.round((new Date(game.completedAt).getTime() - new Date(game.startedAt).getTime()) / 60000)
    : null;

  const summaryParts: string[] = [];
  summaryParts.push(game.courtName);
  summaryParts.push(`${game.players.length}명`);
  if (duration != null) {
    summaryParts.push(`${duration}분`);
  }

  return (
    <SwipeableCard
      rightAction={{
        label: '재등록',
        icon: 'requeue',
        color: colors.secondary,
        onPress: () => onRequeue(game.id),
      }}
    >
      <Animated.View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm, staggerStyle]}>
        <View style={styles.cardLeft}>
          {game.completedAt && (
            <View style={[styles.timeBadge, { backgroundColor: colors.background }]}>
              <Text style={[styles.timeText, { color: colors.textSecondary }]}>
                {new Date(game.completedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
          <View style={styles.info}>
            <View style={styles.courtRow}>
              <Text style={[styles.courtName, { color: colors.text }]}>{game.courtName}</Text>
              {game.gameType && (
                <Badge
                  label={Strings.court.gameType[game.gameType as keyof typeof Strings.court.gameType] || game.gameType}
                  variant="filled"
                  color="secondary"
                  size="sm"
                />
              )}
            </View>
            <Text style={[styles.summary, { color: colors.textLight }]}>{summaryParts.join(' · ')}</Text>
            <Text style={[styles.players, { color: colors.textSecondary }]}>{game.players.map((p) => p.userName).join(', ')}</Text>
          </View>
        </View>
        <TouchableOpacity style={[styles.requeueButton, { backgroundColor: colors.primary, ...shadows.colored(colors.primary) }]} onPress={() => onRequeue(game.id)} activeOpacity={0.8}>
          <Icon name="requeue" size={12} color={palette.white} />
          <Text style={styles.requeueText}>다시 줄서기</Text>
        </TouchableOpacity>
      </Animated.View>
    </SwipeableCard>
  );
}

export function TodayHistoryList({ games, onRequeue }: TodayHistoryListProps) {
  if (games.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={Strings.activity.todayHistory} count={games.length} />
      {games.map((game, index) => (
        <HistoryItem key={game.id} game={game} index={index} onRequeue={onRequeue} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.md },
  timeBadge: {
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  timeText: {
    ...typography.caption,
    fontWeight: '600',
    ...typography.tabular,
  },
  info: { flex: 1 },
  courtRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  courtName: { ...typography.subtitle1 },
  summary: {
    ...typography.caption,
    marginBottom: 2,
  },
  players: { ...typography.body2 },
  requeueButton: {
    borderRadius: radius.xl,
    paddingHorizontal: spacing.mlg,
    paddingVertical: spacing.smd,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  requeueText: { ...typography.buttonSm, color: palette.white },
});
