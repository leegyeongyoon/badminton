import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { courtApi } from '../../../services/court';
import { useCheckinStore } from '../../../store/checkinStore';
import { useCourtRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Colors } from '../../../constants/colors';
import { Strings } from '../../../constants/strings';
import { showAlert, showConfirm } from '../../../utils/alert';
import api from '../../../services/api';
import { useFacilityStore } from '../../../store/facilityStore';

interface ClubSessionInfo {
  clubSessionId: string;
  clubId: string;
  clubName: string;
}

interface AvailablePlayer {
  userId: string;
  userName: string;
  skillLevel: string;
  gender: string | null;
  gamesPlayedToday: number;
  status: 'AVAILABLE' | 'IN_TURN' | 'RESTING';
}

const playerStatusColors: Record<string, string> = {
  AVAILABLE: Colors.playerAvailable,
  IN_TURN: Colors.playerInTurn,
  RESTING: Colors.playerResting,
};

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

function PlayerAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const colorIndex = name.charCodeAt(0) % Colors.avatarColors.length;
  const bg = Colors.avatarColors[colorIndex];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{name[0]}</Text>
    </View>
  );
}

export default function CourtDetailScreen() {
  const { id: courtId } = useLocalSearchParams<{ id: string }>();
  const [courtDetail, setCourtDetail] = useState<any>(null);
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [clubSessionInfo, setClubSessionInfo] = useState<ClubSessionInfo | null>(null);
  const { status: checkinStatus } = useCheckinStore();
  const { boardData } = useFacilityStore();

  useCourtRoom(courtId);

  const loadData = useCallback(async () => {
    if (!courtId) return;
    try {
      const { data } = await courtApi.getTurns(courtId);
      setCourtDetail(data);

      // Load available players at this facility
      if (data?.court?.facilityId) {
        try {
          const { data: playersData } = await api.get(`/facilities/${data.court.facilityId}/players`);
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
  }, [courtId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check if court is part of a club session from board data
  useEffect(() => {
    if (!courtId || !boardData) return;
    const courtBoard = boardData.find((b: any) => b.court?.id === courtId);
    if (courtBoard?.clubSessionInfo) {
      setClubSessionInfo(courtBoard.clubSessionInfo);
    } else {
      setClubSessionInfo(null);
    }
  }, [courtId, boardData]);

  // Socket events
  const reload = useCallback(() => loadData(), [loadData]);
  useSocketEvent('turn:created', reload);
  useSocketEvent('turn:promoted', reload);
  useSocketEvent('turn:started', reload);
  useSocketEvent('turn:completed', reload);
  useSocketEvent('turn:cancelled', reload);
  useSocketEvent('players:updated', reload);

  const playersRequired = courtDetail?.court?.playersRequired || 4;

  const handleRegisterTurn = async () => {
    if (!courtId || selectedPlayers.length !== playersRequired) return;
    try {
      await courtApi.registerTurn(courtId, selectedPlayers);
      setShowRegisterModal(false);
      setSelectedPlayers([]);
      setPlayerSearch('');
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '순번 등록에 실패했습니다');
    }
  };

  const handleCompleteTurn = async (turnId: string) => {
    showConfirm('게임 종료', '게임을 종료하시겠습니까?', async () => {
      try {
        await courtApi.completeTurn(turnId);
        loadData();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
      }
    }, Strings.turn.complete);
  };

  const handleCancelTurn = async (turnId: string) => {
    showConfirm('순번 취소', '순번을 취소하시겠습니까?', async () => {
      try {
        await courtApi.cancelTurn(turnId);
        loadData();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '순번 취소에 실패했습니다');
      }
    }, Strings.turn.cancel);
  };

  const handleRequeue = async (turnId: string) => {
    showConfirm(
      Strings.turn.requeue,
      Strings.turn.requeueDesc,
      async () => {
        try {
          await courtApi.requeueTurn(turnId);
          loadData();
        } catch (err: any) {
          showAlert('오류', err.response?.data?.error || '다시 줄서기에 실패했습니다');
        }
      },
      Strings.common.confirm,
    );
  };

  const togglePlayer = (userId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      if (prev.length >= playersRequired) return prev;
      return [...prev, userId];
    });
  };

  const turns = courtDetail?.turns || [];
  const maxTurns = courtDetail?.maxTurns || 3;
  const court = courtDetail?.court;
  const canRegister = turns.length < maxTurns && court?.status !== 'MAINTENANCE';

  const playingTurn = turns.find((t: any) => t.status === 'PLAYING');
  const waitingTurns = turns.filter((t: any) => t.status === 'WAITING');

  // Filter players in modal by search
  const filterPlayers = (list: AvailablePlayer[]) => {
    if (!playerSearch) return list;
    const q = playerSearch.toLowerCase();
    return list.filter((p) => p.userName.toLowerCase().includes(q));
  };

  const availableList = filterPlayers(availablePlayers.filter((p) => p.status === 'AVAILABLE'));
  const inTurnList = filterPlayers(availablePlayers.filter((p) => p.status === 'IN_TURN'));
  const restingList = filterPlayers(availablePlayers.filter((p) => p.status === 'RESTING'));

  const renderPlayingSection = () => {
    if (!playingTurn) return null;

    return (
      <View style={styles.playingSection}>
        <View style={styles.playingSectionHeader}>
          <Text style={styles.playingSectionTitle}>{Strings.turn.nowPlaying}</Text>
          <View style={styles.playingBadge}>
            <View style={styles.playingDot} />
            <Text style={styles.playingBadgeText}>{Strings.turn.status.PLAYING}</Text>
          </View>
        </View>

        {/* Countdown timer */}
        {playingTurn.timeLimitAt && (
          <CountdownTimer timeLimitAt={playingTurn.timeLimitAt} />
        )}

        {/* Players */}
        <View style={styles.playingPlayers}>
          {playingTurn.players.map((p: any) => (
            <View key={p.id} style={styles.playingPlayerRow}>
              <PlayerAvatar name={p.userName} size={36} />
              <Text style={styles.playingPlayerName}>{p.userName}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.playingActions}>
          <TouchableOpacity
            style={[styles.playingActionBtn, { backgroundColor: Colors.danger }]}
            onPress={() => handleCompleteTurn(playingTurn.id)}
          >
            <Text style={styles.playingActionText}>{Strings.turn.complete}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.playingActionBtn, styles.playingActionOutline]}
            onPress={() => handleRequeue(playingTurn.id)}
          >
            <Text style={[styles.playingActionText, { color: Colors.primary }]}>{Strings.turn.requeue}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderWaitingQueue = () => {
    if (waitingTurns.length === 0) return null;

    return (
      <View style={styles.waitingQueueSection}>
        <Text style={styles.sectionTitle}>
          {Strings.turn.waitingQueue} ({waitingTurns.length})
        </Text>
        {waitingTurns.map((turn: any, index: number) => (
          <View key={turn.id} style={styles.waitingCard}>
            <View style={styles.waitingCardHeader}>
              <View style={styles.waitingPosition}>
                <Text style={styles.waitingPositionText}>{index + 1}</Text>
              </View>
              <Text style={styles.waitingCardTitle}>{turn.position}순번</Text>
              <View style={styles.waitingStatusBadge}>
                <Text style={styles.waitingStatusText}>{Strings.turn.status.WAITING}</Text>
              </View>
            </View>

            <View style={styles.waitingPlayersRow}>
              {turn.players.map((p: any) => (
                <View key={p.id} style={styles.waitingPlayerChip}>
                  <PlayerAvatar name={p.userName} size={22} />
                  <Text style={styles.waitingPlayerName}>{p.userName}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.waitingCancelBtn}
              onPress={() => handleCancelTurn(turn.id)}
            >
              <Text style={styles.waitingCancelText}>{Strings.turn.cancel}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: court?.name || '코트 상세' }} />
      <View style={styles.container}>
        <ScrollView style={styles.scrollContainer}>
          {/* Club session banner */}
          {clubSessionInfo && (
            <View style={styles.clubSessionBanner}>
              <Text style={styles.clubSessionBannerText}>
                {clubSessionInfo.clubName} 모임 코트
              </Text>
            </View>
          )}

          {/* Court status header */}
          {court && (
            <View style={styles.courtInfo}>
              <View style={styles.courtInfoLeft}>
                <Text style={styles.courtName}>{court.name}</Text>
                <View style={styles.courtMeta}>
                  {court.gameType === 'LESSON' && (
                    <View style={[styles.courtMetaBadge, { backgroundColor: Colors.warningLight }]}>
                      <Text style={[styles.courtMetaBadgeText, { color: Colors.warning }]}>{Strings.court.gameType.LESSON}</Text>
                    </View>
                  )}
                  <Text style={styles.courtMetaText}>
                    {turns.length}/{maxTurns} {Strings.turn.indicator}
                  </Text>
                </View>
              </View>
              <View style={[styles.courtStatusBadge, {
                backgroundColor: court.status === 'IN_USE' ? Colors.courtInGame
                  : court.status === 'MAINTENANCE' ? Colors.courtMaintenance
                  : Colors.courtEmpty,
              }]}>
                <Text style={styles.courtStatusText}>
                  {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
                </Text>
              </View>
            </View>
          )}

          {/* Now playing section */}
          {renderPlayingSection()}

          {/* Waiting queue */}
          {renderWaitingQueue()}

          {/* Empty state */}
          {turns.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🏸</Text>
              <Text style={styles.emptyStateText}>{Strings.turn.noTurn}</Text>
              {canRegister && (
                <Text style={styles.emptyStateHint}>아래 버튼으로 순번을 등록하세요</Text>
              )}
            </View>
          )}

          {/* Spacer for button */}
          <View style={{ height: 80 }} />
        </ScrollView>

        {/* Register button */}
        {canRegister && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.registerButton}
              onPress={() => {
                setSelectedPlayers([]);
                setPlayerSearch('');
                setShowRegisterModal(true);
              }}
            >
              <Text style={styles.registerButtonText}>+ {Strings.turn.register}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Player selection modal */}
        <Modal visible={showRegisterModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{Strings.turn.selectPlayers}</Text>
                <TouchableOpacity onPress={() => setShowRegisterModal(false)}>
                  <Text style={styles.modalCloseBtn}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Selected count */}
              <View style={styles.selectedCountRow}>
                <View style={styles.selectedDots}>
                  {Array.from({ length: playersRequired }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.selectedDot,
                        i < selectedPlayers.length && styles.selectedDotFilled,
                      ]}
                    />
                  ))}
                </View>
                <Text style={styles.selectedCountText}>
                  {selectedPlayers.length}/{playersRequired} 선택됨
                </Text>
              </View>

              {/* Search bar */}
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder={Strings.turn.searchPlayers}
                  placeholderTextColor={Colors.textLight}
                  value={playerSearch}
                  onChangeText={setPlayerSearch}
                />
              </View>

              <ScrollView style={styles.memberSelectList}>
                {/* Available players */}
                {availableList.length > 0 && (
                  <View style={styles.statusGroupHeader}>
                    <View style={[styles.statusGroupDot, { backgroundColor: Colors.playerAvailable }]} />
                    <Text style={styles.statusGroupTitle}>
                      {Strings.player.status.AVAILABLE} ({availableList.length})
                    </Text>
                  </View>
                )}
                {availableList.map((u) => {
                  const isSelected = selectedPlayers.includes(u.userId);
                  return (
                    <TouchableOpacity
                      key={u.userId}
                      style={[
                        styles.memberSelectRow,
                        isSelected && styles.memberSelectRowActive,
                      ]}
                      onPress={() => togglePlayer(u.userId)}
                    >
                      <View style={[
                        styles.checkbox,
                        isSelected && styles.checkboxChecked,
                      ]}>
                        {isSelected && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <PlayerAvatar name={u.userName} size={30} />
                      <View style={styles.memberSelectInfo}>
                        <Text style={[
                          styles.memberSelectName,
                          isSelected && styles.memberSelectNameActive,
                        ]}>
                          {u.userName}
                        </Text>
                        <View style={styles.memberSelectMeta}>
                          {u.skillLevel && skillLevelLabels[u.skillLevel] && (
                            <View style={[styles.skillBadgeSmall, { backgroundColor: (skillLevelColors[u.skillLevel] || Colors.textLight) + '20' }]}>
                              <Text style={[styles.skillBadgeSmallText, { color: skillLevelColors[u.skillLevel] || Colors.textLight }]}>
                                {skillLevelLabels[u.skillLevel]}
                              </Text>
                            </View>
                          )}
                          {u.gamesPlayedToday > 0 && (
                            <Text style={styles.playerMetaText}>{u.gamesPlayedToday}게임</Text>
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
                  <View key={u.userId} style={[styles.memberSelectRow, styles.disabledRow]}>
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
                  <View key={u.userId} style={[styles.memberSelectRow, styles.disabledRow]}>
                    <View style={[styles.statusDot, { backgroundColor: Colors.playerResting }]} />
                    <PlayerAvatar name={u.userName} size={30} />
                    <Text style={styles.disabledName}>{u.userName}</Text>
                    <Text style={styles.disabledStatus}>휴식중</Text>
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  selectedPlayers.length !== playersRequired && styles.confirmButtonDisabled,
                ]}
                onPress={handleRegisterTurn}
                disabled={selectedPlayers.length !== playersRequired}
              >
                <Text style={styles.confirmButtonText}>
                  {Strings.turn.register} ({selectedPlayers.length}/{playersRequired})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

// Large countdown timer with circular visual
function CountdownTimer({ timeLimitAt }: { timeLimitAt: string }) {
  const [remaining, setRemaining] = useState('');
  const [color, setColor] = useState(Colors.timerSafe);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const totalMs = 30 * 60 * 1000;
    const update = () => {
      const diff = new Date(timeLimitAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(Strings.timer.expired);
        setColor(Colors.timerDanger);
        setProgress(0);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      setProgress(Math.min(diff / totalMs, 1));

      if (minutes < 2) setColor(Colors.timerDanger);
      else if (minutes < 5) setColor(Colors.timerWarning);
      else setColor(Colors.timerSafe);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timeLimitAt]);

  return (
    <View style={[cdStyles.container, { borderColor: color + '30' }]}>
      <View style={cdStyles.timerContent}>
        <Text style={[cdStyles.label, { color }]}>{Strings.timer.remaining}</Text>
        <Text style={[cdStyles.time, { color }]}>{remaining}</Text>
        <View style={cdStyles.progressBarBg}>
          <View style={[cdStyles.progressBarFill, {
            width: `${progress * 100}%`,
            backgroundColor: color,
          }]} />
        </View>
      </View>
    </View>
  );
}

const cdStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  timerContent: {
    alignItems: 'center',
    width: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  time: {
    fontSize: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginBottom: 10,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flex: 1,
  },
  // Club session banner
  clubSessionBanner: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#7C3AED' + '30',
  },
  clubSessionBannerText: {
    color: '#7C3AED',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },
  // Court info header
  courtInfo: {
    backgroundColor: Colors.surface,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  courtInfoLeft: {
    flex: 1,
  },
  courtName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  courtMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  courtMetaBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  courtMetaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  courtMetaText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  courtStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  courtStatusText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // Now playing section
  playingSection: {
    margin: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  playingSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  playingSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
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
  playingPlayers: {
    gap: 8,
    marginBottom: 12,
  },
  playingPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.divider,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  playingPlayerName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  playingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  playingActionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  playingActionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  playingActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Waiting queue section
  waitingQueueSection: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  waitingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  waitingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
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
  waitingCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  waitingStatusBadge: {
    backgroundColor: Colors.divider,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  waitingStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textLight,
  },
  waitingPlayersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  waitingPlayerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  waitingPlayerName: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500',
  },
  waitingCancelBtn: {
    alignSelf: 'flex-end',
  },
  waitingCancelText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '600',
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  emptyStateHint: {
    fontSize: 13,
    color: Colors.textLight,
  },
  // Bottom register bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
  },
  registerButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // Player card
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  playerCardName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  // Skill badge
  skillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  skillBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Avatar
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  modalCloseBtn: {
    fontSize: 20,
    color: Colors.textLight,
    padding: 4,
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
  // Player list in modal
  memberSelectList: {
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
  memberSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 2,
    gap: 10,
  },
  memberSelectRowActive: {
    backgroundColor: Colors.primaryLight,
  },
  memberSelectInfo: {
    flex: 1,
  },
  memberSelectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
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
  playerMetaText: {
    fontSize: 11,
    color: Colors.textLight,
  },
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
  memberSelectName: {
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500',
  },
  memberSelectNameActive: {
    fontWeight: '600',
    color: Colors.primary,
  },
  // Skill badges
  skillBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  skillBadgeSmallText: {
    fontSize: 10,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
