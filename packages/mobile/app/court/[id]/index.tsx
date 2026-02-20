import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { courtApi } from '../../../services/court';
import { gameApi } from '../../../services/game';
import { queueApi } from '../../../services/queue';
import { useClubStore } from '../../../store/clubStore';
import { useCourtRoom, useSocketEvent } from '../../../hooks/useSocket';
import { Colors } from '../../../constants/colors';
import { Strings } from '../../../constants/strings';
import { showAlert, showConfirm } from '../../../utils/alert';

export default function CourtOperationScreen() {
  const { id: courtId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [hold, setHold] = useState<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [members, setMembers] = useState<any[]>([]);
  const [slotsTotal, setSlotsTotal] = useState(3);
  const [loading, setLoading] = useState(true);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const { clubs, fetchClubs, fetchMembers, currentMembers } = useClubStore();

  useCourtRoom(courtId);

  const loadData = useCallback(async () => {
    if (!courtId) return;
    try {
      const { data: holdData } = await courtApi.getHold(courtId);
      setHold(holdData);
      if (holdData?.slotsTotal) {
        setSlotsTotal(holdData.slotsTotal);
      }
      if (holdData?.id) {
        const lineupRes = await gameApi.getLineup(holdData.id);
        setGames(lineupRes.data);
        // Fetch club members
        await fetchMembers(holdData.clubId);
      } else {
        setGames([]);
      }
      // Get queue count
      try {
        const { data: queueData } = await queueApi.getQueue(courtId);
        setQueueCount(queueData.totalInQueue || 0);
      } catch {
        setQueueCount(0);
      }
    } catch {
      setHold(null);
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [courtId]);

  useEffect(() => {
    loadData();
    fetchClubs();
  }, [loadData]);

  useEffect(() => {
    setMembers(currentMembers);
  }, [currentMembers]);

  // Socket events
  useSocketEvent('hold:created', useCallback(() => loadData(), [loadData]));
  useSocketEvent('hold:released', useCallback(() => loadData(), [loadData]));
  useSocketEvent('lineup:gameAdded', useCallback(() => loadData(), [loadData]));
  useSocketEvent('game:calling', useCallback(() => loadData(), [loadData]));
  useSocketEvent('game:confirmed', useCallback(() => loadData(), [loadData]));
  useSocketEvent('game:started', useCallback(() => loadData(), [loadData]));
  useSocketEvent('game:completed', useCallback(() => loadData(), [loadData]));
  useSocketEvent('queue:joined', useCallback(() => loadData(), [loadData]));
  useSocketEvent('queue:left', useCallback(() => loadData(), [loadData]));
  useSocketEvent('queue:promoted', useCallback(() => loadData(), [loadData]));

  const handleCreateHold = async (clubId: string) => {
    try {
      await courtApi.createHold(courtId!, clubId);
      setShowHoldModal(false);
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '홀드 생성에 실패했습니다');
    }
  };

  const handleReleaseHold = async () => {
    if (!hold) return;
    const warningMsg = queueCount > 0
      ? `대기 중인 모임이 ${queueCount}개 있습니다. 홀드를 해제하면 다음 모임에게 넘어갑니다.\n정말 해제하시겠습니까?`
      : '정말 홀드를 해제하시겠습니까?';

    showConfirm('홀드 해제', warningMsg, async () => {
      try {
        await courtApi.releaseHold(hold.id);
        loadData();
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '홀드 해제에 실패했습니다');
      }
    }, Strings.hold.release);
  };

  const handleCallGame = async (gameId: string) => {
    try {
      await gameApi.call(gameId);
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '호출에 실패했습니다');
    }
  };

  const handleStartGame = async (gameId: string) => {
    try {
      await gameApi.start(gameId);
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '게임 시작에 실패했습니다');
    }
  };

  const handleCompleteGame = async (gameId: string) => {
    try {
      await gameApi.complete(gameId);
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '게임 종료에 실패했습니다');
    }
  };

  const handleCreateGame = async () => {
    if (!hold || selectedPlayers.length !== 4) return;
    try {
      await gameApi.createGame(hold.id, selectedPlayers);
      setShowGameModal(false);
      setSelectedPlayers([]);
      loadData();
    } catch (err: any) {
      showAlert('오류', err.response?.data?.error || '게임 생성에 실패했습니다');
    }
  };

  const togglePlayer = (userId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      }
      if (prev.length >= 4) return prev;
      return [...prev, userId];
    });
  };

  const callStatusColors: Record<string, string> = {
    PENDING: Colors.callPending,
    ACCEPTED: Colors.callAccepted,
    DECLINED: Colors.callDeclined,
    NO_SHOW: Colors.callNoShow,
    REPLACED: Colors.callNoShow,
  };

  // Group games by slot (active, non-completed/cancelled)
  const activeGames = games.filter((g) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED');
  const completedGames = games.filter((g) => g.status === 'COMPLETED');

  const renderSlotCard = (game: any, slotIndex: number) => (
    <View key={game.id} style={styles.slotCard}>
      <View style={styles.slotHeader}>
        <Text style={styles.slotTitle}>슬롯 {slotIndex + 1}</Text>
        <View style={[styles.gameStatusBadge, {
          backgroundColor: game.status === 'IN_PROGRESS' ? Colors.courtInGame
            : game.status === 'CALLING' ? Colors.warning
            : game.status === 'CONFIRMED' ? Colors.secondary
            : Colors.primary,
        }]}>
          <Text style={styles.gameStatusText}>
            {Strings.game.status[game.status as keyof typeof Strings.game.status]}
          </Text>
        </View>
      </View>

      <View style={styles.playerGrid}>
        {game.players.map((p: any) => (
          <View key={p.id} style={styles.playerChip}>
            <View style={[styles.callDot, { backgroundColor: callStatusColors[p.callStatus] }]} />
            <Text style={styles.playerChipText}>{p.userName}</Text>
          </View>
        ))}
      </View>

      <View style={styles.slotActions}>
        {game.status === 'WAITING' && (
          <TouchableOpacity
            style={[styles.slotActionButton, { backgroundColor: Colors.primary }]}
            onPress={() => handleCallGame(game.id)}
          >
            <Text style={styles.slotActionText}>{Strings.game.call}</Text>
          </TouchableOpacity>
        )}
        {game.status === 'CONFIRMED' && (
          <TouchableOpacity
            style={[styles.slotActionButton, { backgroundColor: Colors.secondary }]}
            onPress={() => handleStartGame(game.id)}
          >
            <Text style={styles.slotActionText}>{Strings.game.start}</Text>
          </TouchableOpacity>
        )}
        {game.status === 'IN_PROGRESS' && (
          <TouchableOpacity
            style={[styles.slotActionButton, { backgroundColor: Colors.danger }]}
            onPress={() => handleCompleteGame(game.id)}
          >
            <Text style={styles.slotActionText}>{Strings.game.complete}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderMember = ({ item }: { item: any }) => (
    <View style={styles.memberRow}>
      <View style={[styles.checkinDot, { backgroundColor: item.isCheckedIn ? Colors.secondary : Colors.textLight }]} />
      <Text style={[styles.memberName, !item.isCheckedIn && styles.memberNameInactive]}>
        {item.name}
      </Text>
      {item.isLeader && <Text style={styles.leaderBadge}>리더</Text>}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: '코트 운영' }} />
      <View style={styles.container}>
        {!hold ? (
          <View style={styles.emptyHold}>
            <Text style={styles.emptyText}>홀드 없음</Text>
            <TouchableOpacity
              style={styles.holdButton}
              onPress={() => setShowHoldModal(true)}
            >
              <Text style={styles.holdButtonText}>{Strings.hold.create}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={styles.scrollContainer}>
            {/* Hold info bar */}
            <View style={styles.holdInfo}>
              <View style={styles.holdInfoLeft}>
                <Text style={styles.holdClub}>{hold.club?.name}</Text>
                <Text style={styles.holdCreator}>{hold.createdBy?.name}님이 홀드</Text>
              </View>
              <View style={styles.holdInfoRight}>
                {queueCount > 0 && (
                  <View style={styles.queueWarning}>
                    <Text style={styles.queueWarningText}>대기 {queueCount}팀</Text>
                  </View>
                )}
                <TouchableOpacity onPress={handleReleaseHold}>
                  <Text style={styles.releaseText}>{Strings.hold.release}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Members panel */}
            <View style={styles.membersPanel}>
              <Text style={styles.panelTitle}>출석 모임원</Text>
              <FlatList
                data={members.filter((m: any) => m.isCheckedIn)}
                renderItem={renderMember}
                keyExtractor={(item) => item.userId}
                scrollEnabled={false}
                ListEmptyComponent={
                  <Text style={styles.emptyMemberText}>체크인된 멤버가 없습니다</Text>
                }
              />
            </View>

            {/* Slot cards */}
            <View style={styles.slotsSection}>
              <Text style={styles.panelTitle}>
                슬롯 ({activeGames.length}/{slotsTotal})
              </Text>
              {activeGames.map((game, idx) => renderSlotCard(game, idx))}
              {activeGames.length === 0 && (
                <Text style={styles.emptySlotText}>게임을 추가하세요</Text>
              )}
              {activeGames.length < slotsTotal && (
                <TouchableOpacity
                  style={styles.addGameButton}
                  onPress={() => {
                    setSelectedPlayers([]);
                    setShowGameModal(true);
                  }}
                >
                  <Text style={styles.addGameButtonText}>+ 게임 추가</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Queue link */}
            {queueCount > 0 && (
              <TouchableOpacity
                style={styles.queueLink}
                onPress={() => router.push(`/court/${courtId}/queue`)}
              >
                <Text style={styles.queueLinkText}>
                  대기열 보기 ({queueCount}팀 대기 중)
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Game creation modal */}
        <Modal visible={showGameModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>게임 멤버 선택 (4명)</Text>
              <Text style={styles.selectedCount}>
                {selectedPlayers.length}/4 선택됨
              </Text>
              <ScrollView style={styles.memberSelectList}>
                {members
                  .filter((m: any) => m.isCheckedIn)
                  .map((m: any) => {
                    const isSelected = selectedPlayers.includes(m.userId);
                    return (
                      <TouchableOpacity
                        key={m.userId}
                        style={[
                          styles.memberSelectRow,
                          isSelected && styles.memberSelectRowActive,
                        ]}
                        onPress={() => togglePlayer(m.userId)}
                      >
                        <View style={[
                          styles.checkbox,
                          isSelected && styles.checkboxChecked,
                        ]}>
                          {isSelected && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={[
                          styles.memberSelectName,
                          isSelected && styles.memberSelectNameActive,
                        ]}>
                          {m.name}
                        </Text>
                        {m.isLeader && <Text style={styles.leaderBadge}>리더</Text>}
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  selectedPlayers.length !== 4 && styles.confirmButtonDisabled,
                ]}
                onPress={handleCreateGame}
                disabled={selectedPlayers.length !== 4}
              >
                <Text style={styles.confirmButtonText}>확정</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowGameModal(false)}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Club selection modal for hold */}
        <Modal visible={showHoldModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>모임 선택</Text>
              {clubs.map((club: any) => (
                <TouchableOpacity
                  key={club.id}
                  style={styles.clubOption}
                  onPress={() => handleCreateHold(club.id)}
                >
                  <Text style={styles.clubOptionText}>{club.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setShowHoldModal(false)}>
                <Text style={styles.cancelText}>{Strings.common.cancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    flex: 1,
  },
  emptyHold: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  holdButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  holdButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  holdInfo: {
    backgroundColor: Colors.surface,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  holdInfoLeft: {
    flex: 1,
  },
  holdInfoRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  holdClub: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  holdCreator: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  queueWarning: {
    backgroundColor: Colors.warning,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  queueWarningText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  releaseText: {
    color: Colors.danger,
    fontWeight: '600',
    fontSize: 14,
  },
  membersPanel: {
    backgroundColor: Colors.surface,
    margin: 12,
    borderRadius: 12,
    padding: 14,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  checkinDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  memberName: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  memberNameInactive: {
    color: Colors.textLight,
  },
  leaderBadge: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  emptyMemberText: {
    fontSize: 13,
    color: Colors.textLight,
    textAlign: 'center',
    paddingVertical: 8,
  },
  slotsSection: {
    margin: 12,
    marginTop: 0,
  },
  slotCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  slotTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  gameStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  gameStatusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  playerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  playerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  callDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  playerChipText: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500',
  },
  slotActions: {
    flexDirection: 'row',
    gap: 8,
  },
  slotActionButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  slotActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  emptySlotText: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    paddingVertical: 20,
  },
  addGameButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addGameButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  memberSelectList: {
    maxHeight: 300,
  },
  memberSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 10,
  },
  memberSelectRowActive: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
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
    flex: 1,
  },
  memberSelectNameActive: {
    fontWeight: '600',
    color: Colors.primary,
  },
  confirmButton: {
    backgroundColor: Colors.secondary,
    borderRadius: 12,
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
    fontWeight: '600',
  },
  queueLink: {
    margin: 12,
    marginTop: 0,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  queueLinkText: {
    color: Colors.warning,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
  },
  clubOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  clubOptionText: {
    fontSize: 16,
    color: Colors.text,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
});
