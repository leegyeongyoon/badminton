import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { palette, spacing, radius, opacity } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { PlayerAvatar } from './PlayerAvatar';

interface AvailablePlayer {
  userId: string;
  userName: string;
  skillLevel: string;
  gender: string | null;
  gamesPlayedToday: number;
  status: 'AVAILABLE' | 'IN_TURN' | 'RESTING';
}

interface PlayerSelectorProps {
  players: AvailablePlayer[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
  playersRequired: number;
  searchValue: string;
  onSearchChange: (text: string) => void;
}

const skillLevelLabels: Record<string, string> = {
  BEGINNER: Strings.player.skillLevel.BEGINNER,
  INTERMEDIATE: Strings.player.skillLevel.INTERMEDIATE,
  ADVANCED: Strings.player.skillLevel.ADVANCED,
  EXPERT: Strings.player.skillLevel.EXPERT,
  S: Strings.player.skillLevel.S,
  A: Strings.player.skillLevel.A,
  B: Strings.player.skillLevel.B,
  C: Strings.player.skillLevel.C,
  D: Strings.player.skillLevel.D,
  E: Strings.player.skillLevel.E,
  F: Strings.player.skillLevel.F,
};

export function PlayerSelector({
  players,
  selectedIds,
  onToggle,
  playersRequired,
  searchValue,
  onSearchChange,
}: PlayerSelectorProps) {
  const { colors } = useTheme();

  const skillLevelColors: Record<string, string> = {
    BEGINNER: colors.skillBeginner,
    INTERMEDIATE: colors.skillIntermediate,
    ADVANCED: colors.skillAdvanced,
    EXPERT: colors.skillExpert,
    S: colors.skillS,
    A: colors.skillA,
    B: colors.skillB,
    C: colors.skillC,
    D: colors.skillD,
    E: colors.skillE,
    F: colors.skillF,
  };

  const filterPlayers = (list: AvailablePlayer[]) => {
    if (!searchValue) return list;
    const q = searchValue.toLowerCase();
    return list.filter((p) => p.userName.toLowerCase().includes(q));
  };

  const availableList = filterPlayers(players.filter((p) => p.status === 'AVAILABLE'));
  const inTurnList = filterPlayers(players.filter((p) => p.status === 'IN_TURN'));
  const restingList = filterPlayers(players.filter((p) => p.status === 'RESTING'));

  return (
    <View style={styles.container}>
      {/* Selected count dots */}
      <View style={styles.selectedCountRow}>
        <View style={styles.selectedDots}>
          {Array.from({ length: playersRequired }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.selectedDot,
                { backgroundColor: colors.divider, borderColor: colors.border },
                i < selectedIds.length && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.selectedCountText, { color: colors.textSecondary }]}>
          {selectedIds.length}/{playersRequired} 선택됨
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
          placeholder={Strings.turn.searchPlayers}
          placeholderTextColor={colors.textLight}
          value={searchValue}
          onChangeText={onSearchChange}
        />
      </View>

      <ScrollView style={styles.list}>
        {/* Available players (selectable) */}
        {availableList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: colors.playerAvailable }]} />
            <Text style={[styles.statusGroupTitle, { color: colors.textSecondary }]}>
              {Strings.player.status.AVAILABLE} ({availableList.length})
            </Text>
          </View>
        )}
        {availableList.map((u) => {
          const isSelected = selectedIds.includes(u.userId);
          return (
            <TouchableOpacity
              key={u.userId}
              style={[styles.playerRow, isSelected && { backgroundColor: colors.primaryLight }]}
              onPress={() => onToggle(u.userId)}
            >
              <View style={[styles.checkbox, { borderColor: colors.border }, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <PlayerAvatar name={u.userName} size={30} />
              <View style={styles.playerInfo}>
                <Text style={[styles.playerName, { color: colors.text }, isSelected && { fontWeight: '600', color: colors.primary }]}>
                  {u.userName}
                </Text>
                <View style={styles.playerMeta}>
                  {u.skillLevel && skillLevelLabels[u.skillLevel] && (
                    <View style={[styles.skillBadge, { backgroundColor: alpha(skillLevelColors[u.skillLevel] || colors.textLight, 0.12) }]}>
                      <Text style={[styles.skillBadgeText, { color: skillLevelColors[u.skillLevel] || colors.textLight }]}>
                        {skillLevelLabels[u.skillLevel]}
                      </Text>
                    </View>
                  )}
                  {u.gamesPlayedToday > 0 && (
                    <Text style={[styles.metaText, { color: colors.textLight }]}>{u.gamesPlayedToday}게임</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* In-turn players (disabled) */}
        {inTurnList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: colors.playerInTurn }]} />
            <Text style={[styles.statusGroupTitle, { color: colors.textSecondary }]}>
              {Strings.player.status.IN_TURN} ({inTurnList.length})
            </Text>
          </View>
        )}
        {inTurnList.map((u) => (
          <View key={u.userId} style={[styles.playerRow, styles.disabledRow]}>
            <View style={[styles.statusDot, { backgroundColor: colors.playerInTurn }]} />
            <PlayerAvatar name={u.userName} size={30} />
            <Text style={[styles.disabledName, { color: colors.textLight }]}>{u.userName}</Text>
            <Text style={[styles.disabledStatus, { color: colors.textLight }]}>순번중</Text>
          </View>
        ))}

        {/* Resting players (disabled) */}
        {restingList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: colors.playerResting }]} />
            <Text style={[styles.statusGroupTitle, { color: colors.textSecondary }]}>
              {Strings.player.status.RESTING} ({restingList.length})
            </Text>
          </View>
        )}
        {restingList.map((u) => (
          <View key={u.userId} style={[styles.playerRow, styles.disabledRow]}>
            <View style={[styles.statusDot, { backgroundColor: colors.playerResting }]} />
            <PlayerAvatar name={u.userName} size={30} />
            <Text style={[styles.disabledName, { color: colors.textLight }]}>{u.userName}</Text>
            <Text style={[styles.disabledStatus, { color: colors.textLight }]}>휴식중</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Selected count dots
  selectedCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    marginBottom: spacing.md,
  },
  selectedDots: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  selectedCountText: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Search
  searchContainer: {
    marginBottom: spacing.smd,
  },
  searchInput: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.mlg,
    paddingVertical: spacing.smd,
    fontSize: 14,
    borderWidth: 1,
  },
  // Player list
  list: {
    maxHeight: 350,
  },
  statusGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  statusGroupDot: {
    width: 8,
    height: 8,
    borderRadius: radius.xs,
  },
  statusGroupTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: 2,
    gap: spacing.smd,
  },
  playerInfo: {
    flex: 1,
  },
  playerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '500',
  },
  metaText: {
    fontSize: 11,
  },
  // Checkbox
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: palette.white,
    ...{ fontSize: 14, fontWeight: '700' as const },
  },
  // Skill badge
  skillBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  skillBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Disabled rows
  disabledRow: {
    opacity: opacity.disabled,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.xs,
  },
  disabledName: {
    fontSize: 14,
    flex: 1,
  },
  disabledStatus: {
    fontSize: 12,
  },
});
