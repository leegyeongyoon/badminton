import { View, Text, StyleSheet } from 'react-native';
import { GameSlot } from './GameSlot';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { typography, spacing, radius } from '../../constants/theme';

interface CourtColumnEntry {
  id: string;
  position: number;
  playerNames: string[];
  status: string;
  turnId: string | null;
}

interface CourtColumnProps {
  courtName: string;
  courtId: string;
  entries: CourtColumnEntry[];
  isDedicated?: boolean;
  onSlotPress?: (entryId: string | null, courtId: string) => void;
  onPushEntry?: (entryId: string) => void;
}

export function CourtColumn({
  courtName, courtId, entries, isDedicated, onSlotPress, onPushEntry,
}: CourtColumnProps) {
  const { colors, shadows } = useTheme();

  const playingEntry = entries.find((e) => e.status === 'PLAYING' || e.status === 'MATERIALIZED');
  const queuedEntries = entries.filter((e) => e.status === 'QUEUED');
  const completedEntries = entries.filter((e) => e.status === 'COMPLETED');

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
      <View style={styles.header}>
        <Text style={[styles.courtName, { color: colors.text }]} numberOfLines={1}>
          {courtName}
        </Text>
        {isDedicated && (
          <View style={[styles.dedicatedBadge, { backgroundColor: colors.infoBg }]}>
            <Text style={[styles.dedicatedText, { color: colors.info }]}>{Strings.gameBoard.dedicated}</Text>
          </View>
        )}
      </View>

      {/* Playing slot */}
      {playingEntry && (
        <GameSlot
          playerNames={playingEntry.playerNames}
          maxPlayers={4}
          status={playingEntry.status}
          position={0}
          isPlaying
        />
      )}

      {/* Empty court indicator */}
      {!playingEntry && entries.length === 0 && (
        <View style={[styles.emptySlot, { borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.textLight }]}>비어있음</Text>
        </View>
      )}

      {/* Queued entries */}
      {queuedEntries.map((entry) => (
        <GameSlot
          key={entry.id}
          playerNames={entry.playerNames}
          maxPlayers={4}
          status={entry.status}
          position={entry.position}
          onSlotPress={() => onSlotPress?.(entry.id, courtId)}
          onPush={() => onPushEntry?.(entry.id)}
        />
      ))}

      {/* Add new slot */}
      {onSlotPress && (
        <View
          style={[styles.addSlot, { borderColor: colors.border }]}
        >
          <Text
            style={[styles.addText, { color: colors.primary }]}
            onPress={() => onSlotPress(null, courtId)}
          >
            + 게임 추가
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 160,
    borderRadius: radius.card,
    padding: spacing.smd,
    borderWidth: 1,
    marginRight: spacing.md,
  },
  header: {
    marginBottom: spacing.sm,
  },
  courtName: {
    ...typography.subtitle2,
    marginBottom: 2,
  },
  dedicatedBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  dedicatedText: {
    fontSize: 9,
    fontWeight: '700',
  },
  emptySlot: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.caption,
  },
  addSlot: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
  },
  addText: {
    ...typography.buttonSm,
  },
});
