import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PlayerAvatarRow } from '../shared/PlayerAvatarRow';
import { CountdownTimer } from '../shared/CountdownTimer';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';

const courtStatusColors: Record<string, string> = {
  EMPTY: Colors.courtEmpty,
  IN_USE: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

const gameTypeConfig: Record<string, { icon: string; label: string; color: string }> = {
  DOUBLES: { icon: '\u{1F3F8}', label: Strings.court.gameType.DOUBLES, color: Colors.primary },
  LESSON: { icon: '\u{1F4DA}', label: Strings.court.gameType.LESSON, color: Colors.warning },
};

function getPlayerNames(players: any[] | undefined, max: number): string {
  if (!players || players.length === 0) return '';
  const names = players.slice(0, max).map((p: any) => p.name || p.userName || '?');
  return names.join(', ');
}

interface CourtCardProps {
  court: { id: string; name: string; status: string; gameType?: string };
  turns: any[];
  maxTurns: number;
  clubSessionInfo?: { clubName: string } | null;
  isCheckedIn: boolean;
  currentUserId?: string;
  onPress: (courtId: string) => void;
}

export function CourtCard({
  court,
  turns,
  maxTurns,
  clubSessionInfo,
  isCheckedIn,
  currentUserId,
  onPress,
}: CourtCardProps) {
  const playingTurn = turns.find((t: any) => t.status === 'PLAYING');
  const waitingTurns = turns.filter((t: any) => t.status === 'WAITING');
  const turnsCount = turns.length;
  const borderLeftColor = courtStatusColors[court.status] || Colors.textLight;

  const isMyTurn = useMemo(() => {
    if (!currentUserId) return false;
    return turns.some((t: any) => t.players?.some((p: any) => p.userId === currentUserId));
  }, [turns, currentUserId]);

  const gameType = court.gameType ? gameTypeConfig[court.gameType] : null;

  return (
    <TouchableOpacity
      style={[
        styles.courtCard,
        { borderLeftWidth: 3, borderLeftColor: isMyTurn ? Colors.primary : borderLeftColor },
        isMyTurn && styles.myTurnCard,
      ]}
      onPress={() => onPress(court.id)}
      activeOpacity={0.7}
    >
      {/* Header: name + status badge + waiting badge */}
      <View style={styles.courtHeader}>
        <Text style={styles.courtName}>{court.name}</Text>
        <View style={styles.headerBadges}>
          {waitingTurns.length > 0 && (
            <View style={styles.waitingBadge}>
              <Text style={styles.waitingBadgeText}>대기 {waitingTurns.length}</Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: courtStatusColors[court.status] || Colors.textLight }]}>
            <Text style={styles.statusText}>
              {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
            </Text>
          </View>
        </View>
      </View>

      {/* Game type badge - prominent with icon */}
      {gameType && (
        <View style={[styles.gameTypeBadge, { backgroundColor: gameType.color }]}>
          <Text style={styles.gameTypeText}>{gameType.icon} {gameType.label}</Text>
        </View>
      )}

      {clubSessionInfo && (
        <View style={[styles.gameTypeBadge, { backgroundColor: '#7C3AED' }]}>
          <Text style={styles.gameTypeText}>{clubSessionInfo.clubName}</Text>
        </View>
      )}

      {/* Turn capacity indicator */}
      {court.status !== 'MAINTENANCE' && (
        <View style={styles.turnIndicator}>
          <View style={styles.turnIndicatorBar}>
            <View style={[styles.turnIndicatorFill, {
              width: `${(turnsCount / maxTurns) * 100}%`,
              backgroundColor: turnsCount >= maxTurns ? Colors.danger : Colors.primary,
            }]} />
          </View>
          <Text style={styles.turnIndicatorText}>
            {turnsCount}/{maxTurns}
          </Text>
        </View>
      )}

      {/* Currently playing */}
      {playingTurn && (
        <View style={styles.gameSection}>
          <View style={styles.gameSectionHeader}>
            <Text style={styles.gameSectionTitle}>{Strings.turn.status.PLAYING}</Text>
            {playingTurn.timeLimitAt && (
              <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="badge" />
            )}
          </View>
          <PlayerAvatarRow players={playingTurn.players} />
          {playingTurn.players && playingTurn.players.length > 0 && (
            <Text style={styles.playerNames} numberOfLines={1}>
              {getPlayerNames(playingTurn.players, 4)}
            </Text>
          )}
          {playingTurn.timeLimitAt && (
            <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="bar" />
          )}
        </View>
      )}

      {/* Waiting turns */}
      {waitingTurns.length > 0 && (
        <View style={styles.waitingSection}>
          <Text style={styles.waitingTitle}>
            대기 {waitingTurns.length}순번
          </Text>
          {waitingTurns.slice(0, 2).map((t: any) => (
            <View key={t.id} style={styles.waitingTurnRow}>
              <PlayerAvatarRow players={t.players} max={4} />
              {t.players && t.players.length > 0 && (
                <Text style={styles.waitingPlayerNames} numberOfLines={1}>
                  {getPlayerNames(t.players, 4)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      {isCheckedIn && court.status === 'EMPTY' && (
        <View style={[styles.actionButton, { backgroundColor: Colors.secondary }]}>
          <Text style={styles.actionButtonText}>{Strings.turn.register}</Text>
        </View>
      )}

      {isCheckedIn && court.status === 'IN_USE' && turnsCount < maxTurns && (
        <View style={[styles.actionButton, { backgroundColor: Colors.primary }]}>
          <Text style={styles.actionButtonText}>{Strings.turn.register}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  courtCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    margin: 4,
    maxWidth: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  myTurnCard: {
    backgroundColor: Colors.primaryLight,
    shadowColor: Colors.primary,
    shadowOpacity: 0.12,
  },
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  courtName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1,
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
  waitingBadge: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  waitingBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  gameTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 6,
  },
  gameTypeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  turnIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  turnIndicatorBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  turnIndicatorFill: {
    height: 4,
    borderRadius: 2,
  },
  turnIndicatorText: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  gameSection: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  gameSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  gameSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  playerNames: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  waitingSection: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  waitingTitle: {
    fontSize: 12,
    color: Colors.textLight,
    marginBottom: 4,
  },
  waitingTurnRow: {
    marginTop: 3,
  },
  waitingPlayerNames: {
    fontSize: 10,
    color: Colors.textLight,
    marginTop: 2,
  },
  actionButton: {
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
