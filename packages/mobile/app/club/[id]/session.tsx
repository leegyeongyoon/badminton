import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { clubSessionApi } from '../../../services/clubSession';
import { clubApi } from '../../../services/club';
import { facilityApi } from '../../../services/facility';
import api from '../../../services/api';
import { Colors } from '../../../constants/colors';
import { Strings } from '../../../constants/strings';
import { showAlert, showConfirm } from '../../../utils/alert';

interface ClubMember {
  userId: string;
  name: string;
  role: string;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: string | null;
}

interface CourtData {
  court: { id: string; name: string; status: string };
  turns: any[];
  maxTurns: number;
  clubSessionInfo: any;
}

interface ClubSession {
  id: string;
  clubId: string;
  clubName: string;
  facilityId: string;
  facilityName: string;
  status: string;
  courtIds: string[];
  startedAt: string;
  endedAt: string | null;
}

const playerStatusColors: Record<string, string> = {
  AVAILABLE: Colors.playerAvailable,
  IN_TURN: Colors.playerInTurn,
  RESTING: Colors.playerResting,
};

const playerStatusLabels: Record<string, string> = {
  AVAILABLE: Strings.player.status.AVAILABLE,
  IN_TURN: Strings.player.status.IN_TURN,
  RESTING: Strings.player.status.RESTING,
};

const STATUS_ORDER = ['AVAILABLE', 'IN_TURN', 'RESTING'] as const;
const STATUS_BORDER_COLORS: Record<string, string> = {
  AVAILABLE: Colors.playerAvailable,
  IN_TURN: Colors.playerInTurn,
  RESTING: Colors.playerResting,
};

interface RotationData {
  id: string;
  status: string;
  currentRound: number;
  totalRounds: number;
  participants: Array<{ userId: string; userName: string }>;
}

interface FacilityCourt {
  id: string;
  name: string;
  status: string;
}

export default function ClubSessionScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<ClubSession | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [boardData, setBoardData] = useState<CourtData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkAssignments, setBulkAssignments] = useState<Record<string, string[]>>({});
  const [showCourtModal, setShowCourtModal] = useState(false);
  const [allCourts, setAllCourts] = useState<FacilityCourt[]>([]);
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [rotation, setRotation] = useState<RotationData | null>(null);

  const loadData = useCallback(async () => {
    if (!clubId) return;
    try {
      const { data: sessionData } = await clubSessionApi.getActive(clubId);
      setSession(sessionData);

      if (sessionData) {
        const [membersRes, boardRes, courtsRes] = await Promise.all([
          clubApi.getMembers(clubId),
          facilityApi.getBoard(sessionData.facilityId),
          facilityApi.getCourts(sessionData.facilityId),
        ]);
        setMembers(membersRes.data || []);
        setBoardData(boardRes.data || []);
        setAllCourts(courtsRes.data || []);

        // Load rotation data
        try {
          const { data: rotationData } = await api.get(`/facilities/${sessionData.facilityId}/rotation/current`);
          setRotation(rotationData || null);
        } catch {
          setRotation(null);
        }
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleEndSession = () => {
    if (!session) return;
    showConfirm(
      '모임 종료',
      '모임 활동을 종료하시겠습니까?',
      async () => {
        try {
          await clubSessionApi.end(session.id);
          setSession(null);
          router.back();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.error || '모임 종료에 실패했습니다');
        }
      },
      Strings.common.confirm,
    );
  };

  const handleBulkRegister = async () => {
    if (!session) return;
    const turns = Object.entries(bulkAssignments)
      .filter(([, playerIds]) => playerIds.length > 0)
      .map(([courtId, playerIds]) => ({ courtId, playerIds }));

    if (turns.length === 0) {
      showAlert('알림', '최소 1개 코트에 참가자를 배정하세요');
      return;
    }

    try {
      await clubSessionApi.bulkRegisterTurns(session.id, turns);
      setShowBulkModal(false);
      setBulkAssignments({});
      loadData();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '턴 등록에 실패했습니다');
    }
  };

  const toggleBulkPlayer = (courtId: string, userId: string) => {
    setBulkAssignments((prev) => {
      const current = prev[courtId] || [];
      if (current.includes(userId)) {
        return { ...prev, [courtId]: current.filter((id) => id !== userId) };
      }
      if (current.length >= 4) return prev;
      return { ...prev, [courtId]: [...current, userId] };
    });
  };

  // Court management
  const openCourtModal = () => {
    setSelectedCourtIds(session?.courtIds || []);
    setShowCourtModal(true);
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds((prev) =>
      prev.includes(courtId) ? prev.filter((id) => id !== courtId) : [...prev, courtId],
    );
  };

  const handleSaveCourts = async () => {
    if (!session) return;
    try {
      await clubSessionApi.updateCourts(session.id, selectedCourtIds);
      setShowCourtModal(false);
      loadData();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '코트 변경에 실패했습니다');
    }
  };

  // Auto-recommend balanced groups
  const handleAutoAssign = () => {
    const available = checkedInMembers.filter((m) => m.playerStatus === 'AVAILABLE');
    const courts = sessionCourts.map((c) => c.court.id);
    const assignments: Record<string, string[]> = {};
    let idx = 0;
    for (const courtId of courts) {
      const group: string[] = [];
      while (group.length < 4 && idx < available.length) {
        group.push(available[idx].userId);
        idx++;
      }
      assignments[courtId] = group;
    }
    setBulkAssignments(assignments);
  };

  // Rotation
  const handleAdvanceRotation = () => {
    if (!session || !rotation) return;
    showConfirm(
      '다음 라운드',
      `라운드 ${rotation.currentRound + 1}로 진행하시겠습니까?`,
      async () => {
        try {
          await api.post(`/facilities/${session.facilityId}/rotation/advance`);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.error || '라운드 진행에 실패했습니다');
        }
      },
      Strings.common.confirm,
    );
  };

  const checkedInMembers = members.filter((m) => m.isCheckedIn);
  const sessionCourts = boardData.filter(
    (c) => session?.courtIds.includes(c.court.id),
  );

  // Group members by status
  const membersByStatus = checkedInMembers.reduce<Record<string, ClubMember[]>>((acc, m) => {
    const status = m.playerStatus || 'AVAILABLE';
    if (!acc[status]) acc[status] = [];
    acc[status].push(m);
    return acc;
  }, {});

  const statusCounts = {
    AVAILABLE: (membersByStatus['AVAILABLE'] || []).length,
    IN_TURN: (membersByStatus['IN_TURN'] || []).length,
    RESTING: (membersByStatus['RESTING'] || []).length,
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: '모임 활동' }} />
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>{Strings.common.loading}</Text>
        </View>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: '모임 활동' }} />
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>진행 중인 모임이 없습니다</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `${session.clubName} 모임` }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Session info header */}
        <View style={styles.sessionHeader}>
          <View style={styles.sessionHeaderLeft}>
            <Text style={styles.sessionClubName}>{session.clubName}</Text>
            <Text style={styles.sessionFacility}>{session.facilityName}</Text>
          </View>
          <View style={styles.sessionHeaderRight}>
            <TouchableOpacity style={styles.courtManageBtn} onPress={openCourtModal}>
              <Text style={styles.courtManageBtnText}>코트 관리</Text>
            </TouchableOpacity>
            <View style={styles.sessionStatusBadge}>
              <View style={styles.sessionStatusDot} />
              <Text style={styles.sessionStatusText}>진행중</Text>
            </View>
          </View>
        </View>

        {/* Checked-in members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            체크인된 멤버 ({checkedInMembers.length})
          </Text>
          {checkedInMembers.length > 0 && (
            <View style={styles.statusSummaryBar}>
              <View style={[styles.statusSummaryItem, { backgroundColor: Colors.playerAvailable + '18' }]}>
                <View style={[styles.statusSummaryDot, { backgroundColor: Colors.playerAvailable }]} />
                <Text style={[styles.statusSummaryText, { color: Colors.playerAvailable }]}>
                  가용 {statusCounts.AVAILABLE}
                </Text>
              </View>
              <View style={[styles.statusSummaryItem, { backgroundColor: Colors.playerInTurn + '18' }]}>
                <View style={[styles.statusSummaryDot, { backgroundColor: Colors.playerInTurn }]} />
                <Text style={[styles.statusSummaryText, { color: Colors.playerInTurn }]}>
                  게임중 {statusCounts.IN_TURN}
                </Text>
              </View>
              <View style={[styles.statusSummaryItem, { backgroundColor: Colors.playerResting + '18' }]}>
                <View style={[styles.statusSummaryDot, { backgroundColor: Colors.playerResting }]} />
                <Text style={[styles.statusSummaryText, { color: Colors.playerResting }]}>
                  휴식 {statusCounts.RESTING}
                </Text>
              </View>
            </View>
          )}
          {checkedInMembers.length === 0 ? (
            <Text style={styles.emptyNote}>체크인된 멤버가 없습니다</Text>
          ) : (
            STATUS_ORDER.map((status) => {
              const group = membersByStatus[status];
              if (!group || group.length === 0) return null;
              return (
                <View key={status} style={styles.statusGroup}>
                  <Text style={[styles.statusGroupLabel, { color: STATUS_BORDER_COLORS[status] }]}>
                    {playerStatusLabels[status]} ({group.length})
                  </Text>
                  {group.map((m) => (
                    <View
                      key={m.userId}
                      style={[
                        styles.memberRow,
                        { borderLeftWidth: 3, borderLeftColor: STATUS_BORDER_COLORS[m.playerStatus || 'AVAILABLE'] },
                      ]}
                    >
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>{m.name[0]}</Text>
                      </View>
                      <Text style={styles.memberName}>{m.name}</Text>
                      {m.role !== 'MEMBER' && (
                        <View style={styles.roleBadge}>
                          <Text style={styles.roleBadgeText}>
                            {m.role === 'LEADER' ? '리더' : '스태프'}
                          </Text>
                        </View>
                      )}
                      {m.playerStatus && (
                        <View style={[styles.statusBadge, {
                          backgroundColor: (playerStatusColors[m.playerStatus] || Colors.textLight) + '20',
                        }]}>
                          <View style={[styles.statusDot, {
                            backgroundColor: playerStatusColors[m.playerStatus] || Colors.textLight,
                          }]} />
                          <Text style={[styles.statusBadgeText, {
                            color: playerStatusColors[m.playerStatus] || Colors.textLight,
                          }]}>
                            {playerStatusLabels[m.playerStatus] || m.playerStatus}
                          </Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              );
            })
          )}
        </View>

        {/* Managed courts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            관리 코트 ({sessionCourts.length})
          </Text>
          {sessionCourts.map((c) => {
            const playingTurn = c.turns.find((t: any) => t.status === 'PLAYING');
            const waitingCount = c.turns.filter((t: any) => t.status === 'WAITING').length;

            return (
              <TouchableOpacity
                key={c.court.id}
                style={styles.courtCard}
                onPress={() => router.push(`/court/${c.court.id}`)}
              >
                <View style={styles.courtCardHeader}>
                  <Text style={styles.courtCardName}>{c.court.name}</Text>
                  <Text style={styles.courtCardTurns}>
                    {c.turns.length}/{c.maxTurns}
                  </Text>
                </View>
                {playingTurn ? (
                  <Text style={styles.courtCardPlayers}>
                    {playingTurn.players.map((p: any) => p.userName).join(', ')}
                  </Text>
                ) : (
                  <Text style={styles.courtCardEmpty}>비어있음</Text>
                )}
                {waitingCount > 0 && (
                  <Text style={styles.courtCardWaiting}>대기 {waitingCount}팀</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Rotation integration */}
        {rotation && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>게임 편성</Text>
            <View style={styles.rotationCard}>
              <View style={styles.rotationHeader}>
                <View style={styles.rotationProgressRow}>
                  <Text style={styles.rotationRound}>
                    라운드 {rotation.currentRound} / {rotation.totalRounds}
                  </Text>
                  <View style={[styles.sessionStatusBadge, { backgroundColor: '#EDE9FE' }]}>
                    <Text style={[styles.sessionStatusText, { color: '#7C3AED' }]}>
                      {rotation.status === 'ACTIVE' ? '진행중' : rotation.status}
                    </Text>
                  </View>
                </View>
                <View style={styles.rotationProgressBar}>
                  <View
                    style={[
                      styles.rotationProgressFill,
                      { width: `${(rotation.currentRound / rotation.totalRounds) * 100}%` },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.rotationParticipants}>
                참가자 {rotation.participants.length}명
              </Text>
              <View style={styles.rotationActions}>
                {rotation.status === 'ACTIVE' && rotation.currentRound < rotation.totalRounds && (
                  <TouchableOpacity style={styles.rotationAdvanceBtn} onPress={handleAdvanceRotation}>
                    <Text style={styles.rotationAdvanceBtnText}>다음 라운드</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.rotationDetailBtn}
                  onPress={() => router.push('/admin/rotation')}
                >
                  <Text style={styles.rotationDetailBtnText}>편성 보기</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
            onPress={() => {
              setBulkAssignments({});
              setShowBulkModal(true);
            }}
          >
            <Text style={styles.actionBtnText}>턴 일괄 등록</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#7C3AED' }]}
            onPress={() => router.push(`/admin/rotation?clubSessionId=${session.id}`)}
          >
            <Text style={styles.actionBtnText}>로테이션 시작</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.danger }]}
            onPress={handleEndSession}
          >
            <Text style={styles.actionBtnText}>모임 종료</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bulk register modal */}
      <Modal visible={showBulkModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>턴 일괄 등록</Text>
              <TouchableOpacity onPress={() => setShowBulkModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.bulkCapacityInfo}>
              <Text style={styles.bulkCapacityText}>
                코트당 4명 (복식) | 가용 멤버 {checkedInMembers.filter((m) => m.playerStatus === 'AVAILABLE').length}명 | 코트 {sessionCourts.length}개
              </Text>
              <TouchableOpacity style={styles.autoAssignBtn} onPress={handleAutoAssign}>
                <Text style={styles.autoAssignBtnText}>추천 배정</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              {sessionCourts.map((c) => {
                const assigned = bulkAssignments[c.court.id] || [];
                return (
                  <View key={c.court.id} style={styles.bulkCourtSection}>
                    <View style={styles.bulkCourtHeader}>
                      <Text style={styles.bulkCourtName}>
                        {c.court.name}
                      </Text>
                      <Text style={[
                        styles.bulkCourtCount,
                        assigned.length === 4 && { color: Colors.playerAvailable },
                      ]}>
                        {assigned.length}/4
                      </Text>
                    </View>
                    <View style={styles.bulkSlots}>
                      {[0, 1, 2, 3].map((slot) => {
                        const playerId = assigned[slot];
                        const player = playerId ? checkedInMembers.find((m) => m.userId === playerId) : null;
                        return (
                          <View key={slot} style={[styles.bulkSlot, player && styles.bulkSlotFilled]}>
                            {player ? (
                              <TouchableOpacity
                                style={styles.bulkSlotContent}
                                onPress={() => toggleBulkPlayer(c.court.id, player.userId)}
                              >
                                <Text style={styles.bulkSlotName}>{player.name}</Text>
                                <Text style={styles.bulkSlotRemove}>✕</Text>
                              </TouchableOpacity>
                            ) : (
                              <Text style={styles.bulkSlotEmpty}>빈 슬롯</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {checkedInMembers
                      .filter((m) => m.playerStatus === 'AVAILABLE' && !assigned.includes(m.userId))
                      .filter((m) => !Object.entries(bulkAssignments).some(
                        ([cId, pIds]) => cId !== c.court.id && pIds.includes(m.userId),
                      ))
                      .length > 0 && assigned.length < 4 && (
                      <View style={styles.bulkAvailableList}>
                        {checkedInMembers
                          .filter((m) => m.playerStatus === 'AVAILABLE' && !assigned.includes(m.userId))
                          .filter((m) => !Object.entries(bulkAssignments).some(
                            ([cId, pIds]) => cId !== c.court.id && pIds.includes(m.userId),
                          ))
                          .map((m) => (
                            <TouchableOpacity
                              key={m.userId}
                              style={styles.bulkAvailableChip}
                              onPress={() => toggleBulkPlayer(c.court.id, m.userId)}
                            >
                              <Text style={styles.bulkAvailableChipText}>+ {m.name}</Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.bulkConfirmBtn} onPress={handleBulkRegister}>
              <Text style={styles.bulkConfirmText}>일괄 등록</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Court management modal */}
      <Modal visible={showCourtModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>코트 관리</Text>
              <TouchableOpacity onPress={() => setShowCourtModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              {allCourts.map((court) => {
                const isSelected = selectedCourtIds.includes(court.id);
                return (
                  <TouchableOpacity
                    key={court.id}
                    style={[styles.courtToggleRow, isSelected && styles.courtToggleRowActive]}
                    onPress={() => toggleCourt(court.id)}
                  >
                    <View style={[styles.bulkCheckbox, isSelected && styles.bulkCheckboxActive]}>
                      {isSelected && <Text style={styles.bulkCheckmark}>✓</Text>}
                    </View>
                    <Text style={[styles.courtToggleName, isSelected && { color: Colors.primary, fontWeight: '700' }]}>
                      {court.name}
                    </Text>
                    <Text style={styles.courtToggleStatus}>
                      {court.status === 'AVAILABLE' ? '사용가능' : court.status === 'IN_USE' ? '사용중' : '점검중'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.bulkConfirmBtn} onPress={handleSaveCourts}>
              <Text style={styles.bulkConfirmText}>{Strings.common.save}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  backBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Session header
  sessionHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionHeaderLeft: {
    flex: 1,
  },
  sessionClubName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  sessionFacility: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sessionStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sessionStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7C3AED',
  },
  sessionStatusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
  },
  // Section
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  emptyNote: {
    fontSize: 14,
    color: Colors.textLight,
    fontStyle: 'italic',
  },
  // Members
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    gap: 10,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  memberName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  roleBadge: {
    backgroundColor: Colors.warning + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.warning,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Court cards
  courtCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#7C3AED',
  },
  courtCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  courtCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  courtCardTurns: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textLight,
  },
  courtCardPlayers: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  courtCardEmpty: {
    fontSize: 13,
    color: Colors.textLight,
    fontStyle: 'italic',
  },
  courtCardWaiting: {
    fontSize: 12,
    color: Colors.primary,
    marginTop: 4,
  },
  // Actions
  actions: {
    gap: 10,
    marginTop: 8,
  },
  actionBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
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
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  modalClose: {
    fontSize: 20,
    color: Colors.textLight,
    padding: 4,
  },
  modalScroll: {
    maxHeight: 400,
  },
  // Bulk register
  bulkCourtSection: {
    marginBottom: 16,
  },
  bulkCourtName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7C3AED',
    marginBottom: 8,
  },
  bulkPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 2,
    gap: 10,
  },
  bulkPlayerRowActive: {
    backgroundColor: Colors.primaryLight,
  },
  bulkPlayerRowDisabled: {
    opacity: 0.4,
  },
  bulkCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulkCheckboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  bulkCheckmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  bulkPlayerName: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500',
  },
  bulkConfirmBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  bulkConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // Session header right
  sessionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  courtManageBtn: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  courtManageBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  // Status summary bar
  statusSummaryBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statusSummaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusSummaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusSummaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Status groups
  statusGroup: {
    marginBottom: 8,
  },
  statusGroupLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    marginLeft: 4,
  },
  // Rotation
  rotationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#7C3AED',
  },
  rotationHeader: {
    marginBottom: 8,
  },
  rotationProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rotationRound: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  rotationProgressBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  rotationProgressFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 3,
  },
  rotationParticipants: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  rotationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rotationAdvanceBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rotationAdvanceBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rotationDetailBtn: {
    flex: 1,
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rotationDetailBtnText: {
    color: '#7C3AED',
    fontSize: 14,
    fontWeight: '600',
  },
  // Bulk improvements
  bulkCapacityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  bulkCapacityText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
    flex: 1,
  },
  autoAssignBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  autoAssignBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  bulkCourtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bulkCourtCount: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textLight,
  },
  bulkSlots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  bulkSlot: {
    flex: 1,
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  bulkSlotFilled: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
    borderStyle: 'solid',
  },
  bulkSlotContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bulkSlotName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  bulkSlotRemove: {
    fontSize: 10,
    color: Colors.danger,
    fontWeight: '700',
  },
  bulkSlotEmpty: {
    fontSize: 11,
    color: Colors.textLight,
  },
  bulkAvailableList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
  },
  bulkAvailableChip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bulkAvailableChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  // Court toggle
  courtToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 4,
    gap: 10,
    backgroundColor: Colors.background,
  },
  courtToggleRowActive: {
    backgroundColor: Colors.primaryLight,
  },
  courtToggleName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  courtToggleStatus: {
    fontSize: 12,
    color: Colors.textLight,
  },
});
