import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useFacilityStore } from '../../store/facilityStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import api from '../../services/api';
import { courtApi } from '../../services/court';

interface SessionInfo {
  id: string;
  status: string;
  openedByName: string;
  openedAt: string;
}

interface TurnPlayer {
  userId: string;
  user: { name: string };
}

interface TurnInfo {
  id: string;
  status: string;
  position: number;
  players: TurnPlayer[];
}

interface CourtInfo {
  id: string;
  name: string;
  status: string;
  gameType: string;
  turns: TurnInfo[];
}

interface CheckedInUser {
  userId: string;
  userName: string;
  checkedInAt: string;
  status?: string;
}

interface Capacity {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
}

interface RotationInfo {
  id: string;
  status: string;
  currentRound: number;
  totalRounds: number;
  playerCount: number;
  courtCount: number;
}

interface TodayStats {
  totalGames: number;
  avgWaitMinutes: number;
  peakPlayers: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { selectedFacility } = useFacilityStore();
  const facilityId = checkinStatus?.facilityId || selectedFacility?.id;

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [courts, setCourts] = useState<CourtInfo[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [rotation, setRotation] = useState<RotationInfo | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [checkedInUsers, setCheckedInUsers] = useState<CheckedInUser[]>([]);
  const [usersExpanded, setUsersExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!facilityId) return;
    try {
      const [sessionRes, courtsRes, capacityRes, rotationRes, statsRes, playersRes] = await Promise.all([
        api.get(`/facilities/${facilityId}/sessions/current`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/courts`).catch(() => ({ data: [] })),
        api.get(`/facilities/${facilityId}/capacity`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/rotation/current`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/stats/today`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/players`).catch(() => ({ data: [] })),
      ]);
      setSession(sessionRes.data);
      setCourts(courtsRes.data || []);
      setCapacity(capacityRes.data);
      setRotation(rotationRes.data);
      setTodayStats(statsRes.data);
      setCheckedInUsers((playersRes.data || []).map((p: any) => ({
        userId: p.userId,
        userName: p.userName,
        checkedInAt: p.checkedInAt,
        status: p.status,
      })));
    } catch { /* silent */ }
  }, [facilityId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleOpenSession = () => {
    showConfirm(
      Strings.admin.sessionOpenConfirm,
      Strings.admin.sessionOpenConfirmDesc,
      async () => {
        try {
          await api.post(`/facilities/${facilityId}/sessions/open`, {});
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '운영 시작 실패');
        }
      },
      Strings.common.confirm,
    );
  };

  const handleCloseSession = async () => {
    if (!session) return;
    showConfirm(
      '운영 종료',
      '운영을 종료하면 모든 활성 순번이 취소됩니다. 계속하시겠습니까?',
      async () => {
        try {
          await api.post(`/sessions/${session.id}/close`);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '운영 종료 실패');
        }
      },
      '종료',
    );
  };

  const handleCourtStatus = async (courtId: string, status: string) => {
    try {
      await api.patch(`/courts/${courtId}/status`, { status });
      loadData();
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.message || '코트 상태 변경 실패');
    }
  };

  const handleGameTypeChange = (courtId: string, currentType: string) => {
    const newType = currentType === 'DOUBLES' ? 'LESSON' : 'DOUBLES';
    const newLabel = Strings.court.gameType[newType as keyof typeof Strings.court.gameType] || newType;
    showConfirm(
      '게임 유형 변경',
      `${newLabel}(으)로 변경하시겠습니까?`,
      async () => {
        try {
          await api.patch(`/courts/${courtId}`, { gameType: newType });
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '게임 유형 변경 실패');
        }
      },
      Strings.common.confirm,
    );
  };

  const handleForceComplete = (turnId: string) => {
    showConfirm(
      '강제 종료',
      '이 게임을 강제로 종료하시겠습니까?',
      async () => {
        try {
          await courtApi.completeTurn(turnId);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '강제 종료 실패');
        }
      },
      '종료',
    );
  };

  const handleForceCancel = (turnId: string) => {
    showConfirm(
      '강제 취소',
      '이 순번을 강제로 취소하시겠습니까?',
      async () => {
        try {
          await courtApi.cancelTurn(turnId);
          loadData();
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.message || '강제 취소 실패');
        }
      },
      '취소',
    );
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'AVAILABLE': return Colors.playerAvailable;
      case 'IN_TURN': return Colors.playerInTurn;
      case 'RESTING': return Colors.playerResting;
      default: return Colors.textLight;
    }
  };

  if (!facilityId) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>체크인 후 관리자 메뉴를 사용할 수 있습니다</Text>
      </View>
    );
  }

  const renderCapacityBar = () => {
    if (!capacity || capacity.totalCheckedIn === 0) return null;
    const total = capacity.totalCheckedIn;
    return (
      <View style={styles.capacityBarContainer}>
        <View style={styles.capacityProgressBar}>
          {capacity.availableCount > 0 && (
            <View style={[styles.capacitySegment, {
              flex: capacity.availableCount / total,
              backgroundColor: Colors.playerAvailable,
              borderTopLeftRadius: 4,
              borderBottomLeftRadius: 4,
            }]} />
          )}
          {capacity.inTurnCount > 0 && (
            <View style={[styles.capacitySegment, {
              flex: capacity.inTurnCount / total,
              backgroundColor: Colors.playerInTurn,
            }]} />
          )}
          {capacity.restingCount > 0 && (
            <View style={[styles.capacitySegment, {
              flex: capacity.restingCount / total,
              backgroundColor: Colors.playerResting,
              borderTopRightRadius: 4,
              borderBottomRightRadius: 4,
            }]} />
          )}
        </View>
        <View style={styles.capacityLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.playerAvailable }]} />
            <Text style={styles.legendText}>{Strings.capacity.available} {capacity.availableCount}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.playerInTurn }]} />
            <Text style={styles.legendText}>{Strings.capacity.inTurn} {capacity.inTurnCount}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Colors.playerResting }]} />
            <Text style={styles.legendText}>{Strings.capacity.resting} {capacity.restingCount}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.header}>{Strings.admin.dashboard}</Text>
      <Text style={styles.subHeader}>{checkinStatus?.facilityName || selectedFacility?.name}</Text>

      {/* Quick action buttons */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: session ? Colors.danger : Colors.secondary }]}
          onPress={session ? handleCloseSession : handleOpenSession}
        >
          <Text style={styles.quickBtnText}>
            {session ? Strings.admin.sessionClose : Strings.admin.sessionOpen}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: Colors.primary }]}
          onPress={() => router.push('/admin/rotation')}
        >
          <Text style={styles.quickBtnText}>{Strings.admin.viewRotation}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: Colors.warning }]}
          onPress={() => router.push('/admin/penalties')}
        >
          <Text style={styles.quickBtnText}>패널티 관리</Text>
        </TouchableOpacity>
      </View>

      {/* Session control */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>운영 관리</Text>
        {session ? (
          <View style={styles.sessionCard}>
            <View style={styles.sessionInfo}>
              <View style={[styles.sessionDot, { backgroundColor: Colors.secondary }]} />
              <Text style={styles.sessionText}>운영 중</Text>
              <Text style={styles.sessionOpener}>{session.openedByName}</Text>
            </View>
            <TouchableOpacity
              style={[styles.sessionBtn, { backgroundColor: Colors.danger }]}
              onPress={handleCloseSession}
            >
              <Text style={styles.sessionBtnText}>{Strings.admin.sessionClose}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.sessionBtn, { backgroundColor: Colors.secondary }]}
            onPress={handleOpenSession}
          >
            <Text style={styles.sessionBtnText}>{Strings.admin.sessionOpen}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Capacity with visualization */}
      {capacity && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.admin.capacityOverview}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{capacity.totalCheckedIn}</Text>
              <Text style={styles.statLabel}>총 체크인</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.playerAvailable }]}>{capacity.availableCount}</Text>
              <Text style={styles.statLabel}>{Strings.capacity.available}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.playerInTurn }]}>{capacity.inTurnCount}</Text>
              <Text style={styles.statLabel}>{Strings.capacity.inTurn}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.playerResting }]}>{capacity.restingCount}</Text>
              <Text style={styles.statLabel}>{Strings.capacity.resting}</Text>
            </View>
          </View>
          {renderCapacityBar()}
        </View>
      )}

      {/* Checked-in users */}
      {checkedInUsers.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.collapsibleHeader}
            onPress={() => setUsersExpanded(!usersExpanded)}
          >
            <Text style={styles.sectionTitle}>
              체크인 사용자 ({checkedInUsers.length}명)
            </Text>
            <Text style={styles.expandIcon}>{usersExpanded ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {usersExpanded && (
            <View style={styles.usersList}>
              {checkedInUsers.map((user) => (
                <View key={user.userId} style={styles.userRow}>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarText}>
                      {user.userName.charAt(0)}
                    </Text>
                  </View>
                  <Text style={styles.userName}>{user.userName}</Text>
                  <View style={[styles.userStatusBadge, { backgroundColor: getStatusColor(user.status) }]}>
                    <Text style={styles.userStatusText}>
                      {Strings.player.status[user.status as keyof typeof Strings.player.status] || user.status || '대기'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Today statistics */}
      {todayStats && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{Strings.admin.todayStats}</Text>
          <View style={styles.statsGrid}>
            <View style={styles.todayStatCard}>
              <Text style={styles.todayStatValue}>{todayStats.totalGames}</Text>
              <Text style={styles.todayStatLabel}>{Strings.admin.totalGames}</Text>
            </View>
            <View style={styles.todayStatCard}>
              <Text style={styles.todayStatValue}>
                {todayStats.avgWaitMinutes > 0 ? `${todayStats.avgWaitMinutes}분` : '-'}
              </Text>
              <Text style={styles.todayStatLabel}>{Strings.admin.avgWaitTime}</Text>
            </View>
            <View style={styles.todayStatCard}>
              <Text style={styles.todayStatValue}>{todayStats.peakPlayers}</Text>
              <Text style={styles.todayStatLabel}>{Strings.admin.peakPlayers}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Game scheduling (rotation) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{Strings.rotation.title}</Text>
        {rotation && rotation.status !== 'COMPLETED' && rotation.status !== 'CANCELLED' ? (
          <View style={styles.rotationCard}>
            <Text style={styles.rotationStatus}>
              {rotation.status === 'ACTIVE' ? Strings.admin.inProgress : Strings.rotation.status.DRAFT}
              {' - '}{Strings.admin.roundLabel} {rotation.currentRound}/{rotation.totalRounds}
            </Text>
            <Text style={styles.rotationDetail}>
              {rotation.playerCount}명, {rotation.courtCount}코트
            </Text>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
              onPress={() => router.push('/admin/rotation')}
            >
              <Text style={styles.actionBtnText}>상세 보기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: Colors.primary }]}
            onPress={() => router.push('/admin/rotation')}
          >
            <Text style={styles.actionBtnText}>{Strings.rotation.generate}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Court management */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{Strings.admin.courtManagement}</Text>
        {courts.map((court) => {
          const playingTurn = court.turns?.find((t) => t.status === 'PLAYING');
          const waitingTurns = court.turns?.filter((t) => t.status === 'WAITING') || [];
          return (
            <View key={court.id} style={styles.courtCard}>
              <View style={styles.courtRow}>
                <View style={styles.courtInfo}>
                  <Text style={styles.courtName}>{court.name}</Text>
                  <View style={styles.courtStatusRow}>
                    <View style={[styles.courtStatusDot, {
                      backgroundColor: court.status === 'MAINTENANCE' ? Colors.courtMaintenance
                        : court.status === 'IN_USE' ? Colors.courtInGame
                        : Colors.courtEmpty,
                    }]} />
                    <Text style={[styles.courtStatus, {
                      color: court.status === 'MAINTENANCE' ? Colors.textLight
                        : court.status === 'IN_USE' ? Colors.danger
                        : Colors.secondary,
                    }]}>
                      {Strings.court.status[court.status as keyof typeof Strings.court.status] || court.status}
                    </Text>
                  </View>
                </View>
                <View style={styles.courtActions}>
                  <TouchableOpacity
                    style={[styles.gameTypeBtn, {
                      backgroundColor: court.gameType === 'DOUBLES' ? Colors.primaryLight : Colors.warningLight,
                    }]}
                    onPress={() => handleGameTypeChange(court.id, court.gameType)}
                  >
                    <Text style={[styles.gameTypeBtnText, {
                      color: court.gameType === 'DOUBLES' ? Colors.primary : Colors.warning,
                    }]}>
                      {Strings.court.gameType[court.gameType as keyof typeof Strings.court.gameType] || court.gameType}
                    </Text>
                  </TouchableOpacity>
                  {court.status === 'MAINTENANCE' ? (
                    <TouchableOpacity
                      style={[styles.courtBtn, { backgroundColor: Colors.secondary }]}
                      onPress={() => handleCourtStatus(court.id, 'EMPTY')}
                    >
                      <Text style={styles.courtBtnText}>활성화</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.courtBtn, { backgroundColor: Colors.textLight }]}
                      onPress={() => handleCourtStatus(court.id, 'MAINTENANCE')}
                    >
                      <Text style={styles.courtBtnText}>점검</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {/* Active turn controls */}
              {playingTurn && (
                <View style={styles.turnControl}>
                  <View style={styles.turnInfo}>
                    <View style={[styles.turnStatusDot, { backgroundColor: Colors.playerInTurn }]} />
                    <Text style={styles.turnLabel}>게임 중: </Text>
                    <Text style={styles.turnPlayers}>
                      {playingTurn.players.map((p) => p.user.name).join(', ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.forceBtn, { backgroundColor: Colors.danger }]}
                    onPress={() => handleForceComplete(playingTurn.id)}
                  >
                    <Text style={styles.forceBtnText}>강제 종료</Text>
                  </TouchableOpacity>
                </View>
              )}
              {waitingTurns.map((turn) => (
                <View key={turn.id} style={styles.turnControl}>
                  <View style={styles.turnInfo}>
                    <View style={[styles.turnStatusDot, { backgroundColor: Colors.playerAvailable }]} />
                    <Text style={styles.turnLabel}>대기 #{turn.position}: </Text>
                    <Text style={styles.turnPlayers}>
                      {turn.players.map((p) => p.user.name).join(', ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.forceBtn, { backgroundColor: Colors.textLight }]}
                    onPress={() => handleForceCancel(turn.id)}
                  >
                    <Text style={styles.forceBtnText}>강제 취소</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  header: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  subHeader: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  // Quick actions
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  quickBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  quickBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
  },
  // Session
  sessionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sessionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  sessionOpener: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  sessionBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  sessionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Stats
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // Capacity bar
  capacityBarContainer: {
    marginTop: 10,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
  },
  capacityProgressBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.divider,
    overflow: 'hidden',
    marginBottom: 8,
  },
  capacitySegment: {
    height: 8,
  },
  capacityLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  // Today stats
  todayStatCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  todayStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  todayStatLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  // Rotation
  rotationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
  },
  rotationStatus: {
    fontSize: 15,
    fontWeight: '600',
    color: '#7C3AED',
    marginBottom: 4,
  },
  rotationDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  actionBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Checked-in users
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandIcon: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  usersList: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 8,
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  userName: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  userStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  userStatusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  // Courts
  courtCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  courtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  courtInfo: {
    flex: 1,
  },
  courtName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  courtStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  courtStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  courtStatus: {
    fontSize: 12,
  },
  courtActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gameTypeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  gameTypeBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  courtBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  courtBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Turn controls
  turnControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  turnInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  turnStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  turnLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  turnPlayers: {
    fontSize: 12,
    color: Colors.text,
    flex: 1,
  },
  forceBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  forceBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
