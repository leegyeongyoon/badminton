import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PlayerAvatarRow } from '../shared/PlayerAvatarRow';
import { CountdownTimer } from '../shared/CountdownTimer';
import { ConeIcon } from '../ui/ConeIcon';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { typography, spacing, radius } from '../../constants/theme';

function getPlayerNames(players: any[] | undefined, max: number): string {
  if (!players || players.length === 0) return '';
  const names = players.slice(0, max).map((p: any) => p.name || p.userName || '?');
  return names.join(', ');
}

interface CourtConeCardProps {
  court: { id: string; name: string; status: string; gameType?: string };
  turns: any[];
  maxTurns: number;
  clubSessionInfo?: { clubName: string } | null;
  isCheckedIn: boolean;
  currentUserId?: string;
  onPress: (courtId: string) => void;
  index?: number;
}

function ConeRow({ count, filled, color }: { count: number; filled: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={coneRowStyles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <ConeIcon key={i} size={14} filled={i < filled} color={i < filled ? color : colors.border} />
      ))}
    </View>
  );
}

function CourtConeCardInner({
  court, turns, maxTurns, clubSessionInfo, isCheckedIn, currentUserId, onPress,
}: CourtConeCardProps) {
  const { colors, shadows } = useTheme();

  const STATUS_COLOR: Record<string, string> = {
    EMPTY: colors.courtEmpty,
    IN_USE: colors.courtInGame,
    MAINTENANCE: colors.courtMaintenance,
  };

  const playingTurn = turns.find((t: any) => t.status === 'PLAYING');
  const waitingTurns = turns.filter((t: any) => t.status === 'WAITING');
  const turnsCount = turns.length;
  const borderLeftColor = STATUS_COLOR[court.status] || colors.textLight;

  const isMyTurn = useMemo(() => {
    if (!currentUserId) return false;
    return turns.some((t: any) => t.players?.some((p: any) => p.userId === currentUserId));
  }, [turns, currentUserId]);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        shadows.sm,
        { borderLeftWidth: 3, borderLeftColor: isMyTurn ? colors.primary : borderLeftColor },
        isMyTurn && { backgroundColor: colors.primaryLight },
      ]}
      onPress={() => onPress(court.id)}
      activeOpacity={0.7}
    >
      {/* MY TURN badge */}
      {isMyTurn && (
        <View style={[styles.myTurnBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.myTurnText}>MY TURN</Text>
        </View>
      )}

      {/* Header: name + status */}
      <View style={styles.header}>
        <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>
          {court.name}
        </Text>
        <View style={styles.headerRight}>
          {waitingTurns.length > 0 && (
            <View style={[styles.waitingBadge, { backgroundColor: colors.warning }]}>
              <Text style={styles.waitingBadgeText}>대기 {waitingTurns.length}</Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[court.status] || colors.textLight }]}>
            <Text style={styles.statusText}>
              {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
            </Text>
          </View>
        </View>
      </View>

      {/* Club badge */}
      {clubSessionInfo && (
        <View style={[styles.clubBadge, { backgroundColor: '#7C3AED' }]}>
          <Text style={styles.clubBadgeText}>{clubSessionInfo.clubName}</Text>
        </View>
      )}

      {/* Turn capacity bar */}
      {court.status !== 'MAINTENANCE' && (
        <View style={styles.capacityRow}>
          <View style={[styles.capacityBar, { backgroundColor: colors.divider }]}>
            <View style={[styles.capacityFill, {
              width: `${(turnsCount / maxTurns) * 100}%`,
              backgroundColor: turnsCount >= maxTurns ? colors.danger : colors.primary,
            }]} />
          </View>
          <Text style={[styles.capacityText, { color: colors.textLight }]}>
            {turnsCount}/{maxTurns}
          </Text>
        </View>
      )}

      {/* Playing turn with cones */}
      {playingTurn && (
        <View style={[styles.turnSection, { borderTopColor: colors.divider }]}>
          <View style={styles.turnHeader}>
            <ConeRow count={4} filled={playingTurn.players?.length || 0} color={colors.courtInGame} />
            <Text style={[styles.turnLabel, { color: colors.courtInGame }]}>
              {Strings.turn.status.PLAYING}
            </Text>
            {playingTurn.timeLimitAt && (
              <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="badge" />
            )}
          </View>
          <Text style={[styles.playerNames, { color: colors.textSecondary }]} numberOfLines={1}>
            {getPlayerNames(playingTurn.players, 4)}
          </Text>
          {playingTurn.timeLimitAt && (
            <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="bar" />
          )}
        </View>
      )}

      {/* Waiting turns with cones */}
      {waitingTurns.slice(0, 2).map((turn: any, idx: number) => (
        <View key={turn.id} style={[styles.waitingRow, { borderTopColor: colors.divider }]}>
          <View style={styles.turnHeader}>
            <ConeRow count={4} filled={turn.players?.length || 0} color={colors.primary} />
            <Text style={[styles.waitingLabel, { color: colors.textLight }]}>
              대기 {idx + 1}
            </Text>
          </View>
          <Text style={[styles.waitingNames, { color: colors.textLight }]} numberOfLines={1}>
            {getPlayerNames(turn.players, 4)}
          </Text>
        </View>
      ))}

      {/* CTA */}
      {isCheckedIn && court.status === 'EMPTY' && turnsCount === 0 && (
        <View style={[styles.ctaBtn, { backgroundColor: colors.secondary }]}>
          <Text style={styles.ctaBtnText}>{Strings.turn.placeCone}</Text>
        </View>
      )}
      {isCheckedIn && court.status !== 'MAINTENANCE' && turnsCount > 0 && turnsCount < maxTurns && (
        <Text style={[styles.waitCta, { color: colors.primary }]}>{Strings.turn.placeCone}</Text>
      )}
    </TouchableOpacity>
  );
}

function arePropsEqual(prev: CourtConeCardProps, next: CourtConeCardProps): boolean {
  return (
    prev.court.id === next.court.id &&
    prev.court.status === next.court.status &&
    prev.turns.length === next.turns.length &&
    prev.maxTurns === next.maxTurns &&
    prev.isCheckedIn === next.isCheckedIn &&
    prev.currentUserId === next.currentUserId &&
    prev.turns.map((t: any) => t.id).join(',') === next.turns.map((t: any) => t.id).join(',')
  );
}

export const CourtConeCard = React.memo(CourtConeCardInner, arePropsEqual);

const coneRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
});

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.card,
    padding: spacing.mlg,
    margin: spacing.xs,
    maxWidth: '48%',
    borderWidth: 1,
    gap: spacing.xs,
  },
  myTurnBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.md,
  },
  myTurnText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courtName: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  waitingBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  waitingBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  clubBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  clubBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  capacityBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  capacityFill: {
    height: 4,
    borderRadius: 2,
  },
  capacityText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  turnSection: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    gap: 3,
  },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  turnLabel: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  playerNames: {
    fontSize: 11,
    marginLeft: 2,
  },
  waitingRow: {
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  waitingLabel: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  waitingNames: {
    fontSize: 10,
    marginLeft: 2,
  },
  ctaBtn: {
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  waitCta: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
