import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
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

const skillLevelColors: Record<string, string> = {
  BEGINNER: Colors.skillBeginner,
  INTERMEDIATE: Colors.skillIntermediate,
  ADVANCED: Colors.skillAdvanced,
  EXPERT: Colors.skillExpert,
};

const skillLevelLabels: Record<string, string> = {
  BEGINNER: Strings.player.skillLevel.BEGINNER,
  INTERMEDIATE: Strings.player.skillLevel.INTERMEDIATE,
  ADVANCED: Strings.player.skillLevel.ADVANCED,
  EXPERT: Strings.player.skillLevel.EXPERT,
};

export function PlayerSelector({
  players,
  selectedIds,
  onToggle,
  playersRequired,
  searchValue,
  onSearchChange,
}: PlayerSelectorProps) {
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
                i < selectedIds.length && styles.selectedDotFilled,
              ]}
            />
          ))}
        </View>
        <Text style={styles.selectedCountText}>
          {selectedIds.length}/{playersRequired} 선택됨
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={Strings.turn.searchPlayers}
          placeholderTextColor={Colors.textLight}
          value={searchValue}
          onChangeText={onSearchChange}
        />
      </View>

      <ScrollView style={styles.list}>
        {/* Available players (selectable) */}
        {availableList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: Colors.playerAvailable }]} />
            <Text style={styles.statusGroupTitle}>
              {Strings.player.status.AVAILABLE} ({availableList.length})
            </Text>
          </View>
        )}
        {availableList.map((u) => {
          const isSelected = selectedIds.includes(u.userId);
          return (
            <TouchableOpacity
              key={u.userId}
              style={[styles.playerRow, isSelected && styles.playerRowActive]}
              onPress={() => onToggle(u.userId)}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <PlayerAvatar name={u.userName} size={30} />
              <View style={styles.playerInfo}>
                <Text style={[styles.playerName, isSelected && styles.playerNameActive]}>
                  {u.userName}
                </Text>
                <View style={styles.playerMeta}>
                  {u.skillLevel && skillLevelLabels[u.skillLevel] && (
                    <View style={[styles.skillBadge, { backgroundColor: (skillLevelColors[u.skillLevel] || Colors.textLight) + '20' }]}>
                      <Text style={[styles.skillBadgeText, { color: skillLevelColors[u.skillLevel] || Colors.textLight }]}>
                        {skillLevelLabels[u.skillLevel]}
                      </Text>
                    </View>
                  )}
                  {u.gamesPlayedToday > 0 && (
                    <Text style={styles.metaText}>{u.gamesPlayedToday}게임</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* In-turn players (disabled) */}
        {inTurnList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: Colors.playerInTurn }]} />
            <Text style={styles.statusGroupTitle}>
              {Strings.player.status.IN_TURN} ({inTurnList.length})
            </Text>
          </View>
        )}
        {inTurnList.map((u) => (
          <View key={u.userId} style={[styles.playerRow, styles.disabledRow]}>
            <View style={[styles.statusDot, { backgroundColor: Colors.playerInTurn }]} />
            <PlayerAvatar name={u.userName} size={30} />
            <Text style={styles.disabledName}>{u.userName}</Text>
            <Text style={styles.disabledStatus}>순번중</Text>
          </View>
        ))}

        {/* Resting players (disabled) */}
        {restingList.length > 0 && (
          <View style={styles.statusGroupHeader}>
            <View style={[styles.statusGroupDot, { backgroundColor: Colors.playerResting }]} />
            <Text style={styles.statusGroupTitle}>
              {Strings.player.status.RESTING} ({restingList.length})
            </Text>
          </View>
        )}
        {restingList.map((u) => (
          <View key={u.userId} style={[styles.playerRow, styles.disabledRow]}>
            <View style={[styles.statusDot, { backgroundColor: Colors.playerResting }]} />
            <PlayerAvatar name={u.userName} size={30} />
            <Text style={styles.disabledName}>{u.userName}</Text>
            <Text style={styles.disabledStatus}>휴식중</Text>
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
    gap: 10,
    marginBottom: 12,
  },
  selectedDots: {
    flexDirection: 'row',
    gap: 6,
  },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.divider,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  selectedDotFilled: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  selectedCountText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  // Search
  searchContainer: {
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // Player list
  list: {
    maxHeight: 350,
  },
  statusGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  statusGroupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusGroupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 2,
    gap: 10,
  },
  playerRowActive: {
    backgroundColor: Colors.primaryLight,
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
    color: Colors.text,
    fontWeight: '500',
  },
  playerNameActive: {
    fontWeight: '600',
    color: Colors.primary,
  },
  metaText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  // Checkbox
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  // Skill badge
  skillBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  skillBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Disabled rows
  disabledRow: {
    opacity: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  disabledName: {
    fontSize: 14,
    color: Colors.textLight,
    flex: 1,
  },
  disabledStatus: {
    fontSize: 12,
    color: Colors.textLight,
  },
});
