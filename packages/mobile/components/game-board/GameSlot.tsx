import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ConeIcon } from '../ui/ConeIcon';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { typography, spacing, radius, palette } from '../../constants/theme';

interface GameSlotProps {
  playerNames: string[];
  maxPlayers: number;
  status: string;
  position: number;
  isPlaying?: boolean;
  onSlotPress?: () => void;
  onPush?: () => void;
}

export function GameSlot({
  playerNames, maxPlayers, status, position, isPlaying, onSlotPress, onPush,
}: GameSlotProps) {
  const { colors, shadows } = useTheme();

  const isFull = playerNames.length >= maxPlayers;
  const isQueued = status === 'QUEUED';
  const isMaterialized = status === 'MATERIALIZED' || status === 'PLAYING';
  const isCompleted = status === 'COMPLETED';

  const bgColor = isPlaying
    ? colors.primaryLight
    : isMaterialized
      ? colors.secondaryLight
      : isCompleted
        ? colors.surface
        : colors.background;

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: bgColor, borderColor: colors.border }, isCompleted && styles.completed]}
      onPress={onSlotPress}
      activeOpacity={0.7}
      disabled={!isQueued}
    >
      {/* Position label */}
      <View style={styles.header}>
        <Text style={[styles.positionLabel, { color: isPlaying ? colors.primary : colors.textSecondary }]}>
          {isPlaying ? '플레이 중' : `대기 ${position}`}
        </Text>
        {isQueued && isFull && onPush && (
          <TouchableOpacity
            style={[styles.pushButton, { backgroundColor: colors.primary }]}
            onPress={onPush}
          >
            <Text style={styles.pushButtonText}>걸기</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cone grid */}
      <View style={styles.conesRow}>
        {Array.from({ length: maxPlayers }).map((_, i) => {
          const name = playerNames[i];
          return (
            <View key={i} style={styles.coneSlot}>
              <ConeIcon
                size={18}
                filled={!!name}
                dimmed={!name}
                color={name ? (isPlaying ? colors.primary : colors.secondary) : undefined}
              />
              <Text
                style={[styles.coneName, { color: name ? colors.text : colors.textLight }]}
                numberOfLines={1}
              >
                {name || '__'}
              </Text>
            </View>
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    padding: spacing.smd,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  completed: { opacity: 0.4 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  positionLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  pushButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  pushButtonText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '700',
  },
  conesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  coneSlot: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  coneName: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
});
