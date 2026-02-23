import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { BottomSheet } from '../shared/BottomSheet';
import { PlayerSelector } from '../shared/PlayerSelector';
import { PlayerAvatarRow } from '../shared/PlayerAvatarRow';
import { CountdownTimer } from '../shared/CountdownTimer';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { courtApi } from '../../services/court';
import api from '../../services/api';
import { showAlert } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';

interface AvailablePlayer {
  userId: string;
  userName: string;
  skillLevel: string;
  gender: string | null;
  gamesPlayedToday: number;
  status: 'AVAILABLE' | 'IN_TURN' | 'RESTING';
}

interface TurnPlayer {
  id: string;
  userId: string;
  userName: string;
}

interface CourtTurn {
  id: string;
  courtId: string;
  position: number;
  status: string;
  gameType: string;
  createdById: string;
  createdByName: string;
  players: TurnPlayer[];
  game: any | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeLimitAt: string | null;
}

interface CourtDetail {
  court: {
    id: string;
    name: string;
    facilityId: string;
    status: string;
    gameType: string;
    playersRequired: number;
  };
  turns: CourtTurn[];
  maxTurns: number;
}

interface CourtBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  courtId: string | null;
  facilityId: string | undefined;
  onTurnRegistered?: () => void;
}

const courtStatusColors: Record<string, string> = {
  EMPTY: Colors.courtEmpty,
  IN_USE: Colors.courtInGame,
  MAINTENANCE: Colors.courtMaintenance,
};

export function CourtBottomSheet({
  visible,
  onClose,
  courtId,
  facilityId,
  onTurnRegistered,
}: CourtBottomSheetProps) {
  const [courtDetail, setCourtDetail] = useState<CourtDetail | null>(null);
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load court data + available players when sheet opens
  const loadData = useCallback(async () => {
    if (!courtId) return;
    setLoading(true);
    try {
      const { data } = await courtApi.getTurns(courtId);
      setCourtDetail(data);

      // Load available players from the facility
      const fId = facilityId || data?.court?.facilityId;
      if (fId) {
        try {
          const { data: playersData } = await api.get(`/facilities/${fId}/players`);
          setAvailablePlayers(playersData || []);
        } catch {
          setAvailablePlayers([]);
        }
      }
    } catch {
      setCourtDetail(null);
    } finally {
      setLoading(false);
    }
  }, [courtId, facilityId]);

  useEffect(() => {
    if (visible && courtId) {
      // Reset state on open
      setSelectedPlayers([]);
      setPlayerSearch('');
      loadData();
    }
  }, [visible, courtId, loadData]);

  const court = courtDetail?.court;
  const turns = courtDetail?.turns || [];
  const maxTurns = courtDetail?.maxTurns || 3;
  const playersRequired = court?.playersRequired || 4;
  const playingTurn = turns.find((t) => t.status === 'PLAYING');
  const waitingTurns = turns.filter((t) => t.status === 'WAITING');
  const canRegister = turns.length < maxTurns && court?.status !== 'MAINTENANCE';

  const handleTogglePlayer = useCallback((userId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      if (prev.length >= playersRequired) return prev;
      return [...prev, userId];
    });
  }, [playersRequired]);

  const handleSubmit = useCallback(async () => {
    if (!courtId || selectedPlayers.length !== playersRequired) return;
    setSubmitting(true);
    try {
      await courtApi.registerTurn(courtId, selectedPlayers);
      setSelectedPlayers([]);
      setPlayerSearch('');
      onTurnRegistered?.();
      onClose();
      showSuccess('순번이 등록되었습니다');
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '순번 등록에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }, [courtId, selectedPlayers, playersRequired, onTurnRegistered, onClose]);

  const renderCourtHeader = () => {
    if (!court) return null;
    const statusColor = courtStatusColors[court.status] || Colors.textLight;
    const statusLabel =
      Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status;

    return (
      <View style={styles.courtHeader}>
        <View style={styles.courtHeaderLeft}>
          <Text style={styles.courtName}>{court.name}</Text>
          <View style={styles.courtMeta}>
            {court.gameType === 'LESSON' && (
              <View style={styles.lessonBadge}>
                <Text style={styles.lessonBadgeText}>{Strings.court.gameType.LESSON}</Text>
              </View>
            )}
            <Text style={styles.courtMetaText}>
              {turns.length}/{maxTurns} {Strings.turn.indicator}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusBadgeText}>{statusLabel}</Text>
        </View>
      </View>
    );
  };

  const renderCurrentGame = () => {
    if (!playingTurn) return null;
    return (
      <View style={styles.currentGameSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{Strings.turn.nowPlaying}</Text>
          <View style={styles.playingBadge}>
            <View style={styles.playingDot} />
            <Text style={styles.playingBadgeText}>{Strings.turn.status.PLAYING}</Text>
          </View>
        </View>

        {playingTurn.timeLimitAt && (
          <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} mode="large" />
        )}

        <View style={styles.playerChipsRow}>
          {playingTurn.players.map((p) => (
            <View key={p.id} style={styles.playerChip}>
              <Text style={styles.playerChipText}>{p.userName}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderWaitingQueue = () => {
    if (waitingTurns.length === 0) return null;
    return (
      <View style={styles.waitingSection}>
        <Text style={styles.sectionTitle}>
          {Strings.turn.waitingQueue} ({waitingTurns.length})
        </Text>
        {waitingTurns.map((turn, index) => (
          <View key={turn.id} style={styles.waitingItem}>
            <View style={styles.waitingPosition}>
              <Text style={styles.waitingPositionText}>{index + 1}</Text>
            </View>
            <View style={styles.waitingItemPlayers}>
              <PlayerAvatarRow players={turn.players} avatarSize={22} />
            </View>
            <Text style={styles.waitingPlayerNames}>
              {turn.players.map((p) => p.userName).join(', ')}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderPlayerSelection = () => {
    if (!canRegister) return null;
    return (
      <View style={styles.selectionSection}>
        <View style={styles.selectionDivider} />
        <Text style={styles.selectionTitle}>{Strings.turn.selectPlayers}</Text>
        <PlayerSelector
          players={availablePlayers}
          selectedIds={selectedPlayers}
          onToggle={handleTogglePlayer}
          playersRequired={playersRequired}
          searchValue={playerSearch}
          onSearchChange={setPlayerSearch}
        />
      </View>
    );
  };

  const renderSubmitButton = () => {
    if (!canRegister) return null;
    const isReady = selectedPlayers.length === playersRequired;
    return (
      <TouchableOpacity
        style={[styles.submitButton, !isReady && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!isReady || submitting}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>
            {Strings.turn.register} ({selectedPlayers.length}/{playersRequired})
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={court?.name || Strings.turn.register}
      maxHeight={90}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{Strings.common.loading}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {renderCourtHeader()}
          {renderCurrentGame()}
          {renderWaitingQueue()}
          {renderPlayerSelection()}

          {/* Empty state when no turns and can't register */}
          {turns.length === 0 && canRegister && (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyHintText}>{Strings.turn.noTurn}</Text>
            </View>
          )}

          {/* Maintenance notice */}
          {court?.status === 'MAINTENANCE' && (
            <View style={styles.maintenanceNotice}>
              <Text style={styles.maintenanceText}>
                {Strings.court.status.MAINTENANCE} - 순번 등록이 불가합니다
              </Text>
            </View>
          )}

          {renderSubmitButton()}

          {/* Bottom padding for safe area */}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flex: 1,
  },
  loadingContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },

  // Court header
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    marginBottom: 14,
  },
  courtHeaderLeft: {
    flex: 1,
  },
  courtName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  courtMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  lessonBadge: {
    backgroundColor: Colors.warningLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  lessonBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.warning,
  },
  courtMetaText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },

  // Current game
  currentGameSection: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  playingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dangerLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  playingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.danger,
  },
  playingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.danger,
  },
  playerChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  playerChip: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  playerChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
  },

  // Waiting queue
  waitingSection: {
    marginBottom: 14,
  },
  waitingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  waitingPosition: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingPositionText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  waitingItemPlayers: {
    marginRight: 4,
  },
  waitingPlayerNames: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },

  // Player selection
  selectionSection: {
    flex: 1,
  },
  selectionDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginBottom: 14,
  },
  selectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },

  // Submit button
  submitButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Empty/maintenance states
  emptyHint: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyHintText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  maintenanceNotice: {
    backgroundColor: Colors.divider,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  maintenanceText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
