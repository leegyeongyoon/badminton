import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { clubSessionApi } from '../../services/clubSession';
import { facilityApi } from '../../services/facility';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';

interface ClubMember {
  userId: string;
  name: string;
  role: string;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: string | null;
}

interface FacilityCourt {
  id: string;
  name: string;
  status: string;
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

const roleLabels: Record<string, string> = {
  LEADER: '대표',
  STAFF: '운영진',
  MEMBER: '회원',
};

export default function ClubDetailScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentMembers, fetchMembers, clubs } = useClubStore();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();

  const [activeSession, setActiveSession] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ClubMember | null>(null);
  const [facilityCourts, setFacilityCourts] = useState<FacilityCourt[]>([]);
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  const club = clubs.find((c) => c.id === clubId);
  const myMembership = currentMembers.find((m) => m.userId === user?.id);
  const isLeaderOrStaff = myMembership?.role === 'LEADER' || myMembership?.role === 'STAFF';
  const isLeader = myMembership?.role === 'LEADER';
  const checkedInFacilityId = checkinStatus?.facilityId;

  const loadActiveSession = useCallback(async () => {
    if (!clubId) return;
    setLoadingSession(true);
    try {
      const { data } = await clubSessionApi.getActive(clubId);
      setActiveSession(data);
    } catch {
      setActiveSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, [clubId]);

  useEffect(() => {
    if (clubId) {
      fetchMembers(clubId);
      loadActiveSession();
    }
  }, [clubId]);

  const onRefresh = useCallback(async () => {
    if (clubId) {
      await Promise.all([
        fetchMembers(clubId),
        loadActiveSession(),
      ]);
    }
  }, [clubId]);

  // Load facility courts when opening start session modal
  const handleOpenStartModal = async () => {
    if (!checkedInFacilityId) {
      showAlert('알림', '체크인 후에 모임을 시작할 수 있습니다');
      return;
    }
    try {
      const { data } = await facilityApi.get(checkedInFacilityId);
      setFacilityCourts(data.courts || []);
      setSelectedCourtIds([]);
      setShowStartModal(true);
    } catch {
      showAlert(Strings.common.error, '시설 정보를 불러올 수 없습니다');
    }
  };

  const handleStartSession = async () => {
    if (!clubId || !checkedInFacilityId) return;
    setIsStarting(true);
    try {
      await clubSessionApi.start(clubId, {
        facilityId: checkedInFacilityId,
        courtIds: selectedCourtIds.length > 0 ? selectedCourtIds : undefined,
      });
      setShowStartModal(false);
      await loadActiveSession();
      // Navigate to session dashboard
      router.push(`/club/${clubId}/session`);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '모임 시작에 실패했습니다');
    } finally {
      setIsStarting(false);
    }
  };

  const handleChangeRole = async (newRole: string) => {
    if (!clubId || !selectedMember) return;
    try {
      await clubSessionApi.updateMemberRole(clubId, selectedMember.userId, newRole);
      setShowRoleModal(false);
      setSelectedMember(null);
      fetchMembers(clubId);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '역할 변경에 실패했습니다');
    }
  };

  const toggleCourt = (courtId: string) => {
    setSelectedCourtIds((prev) =>
      prev.includes(courtId) ? prev.filter((id) => id !== courtId) : [...prev, courtId],
    );
  };

  const checkedInMembers = currentMembers.filter((m) => m.isCheckedIn);
  const notCheckedInMembers = currentMembers.filter((m) => !m.isCheckedIn);

  const renderMember = ({ item }: { item: ClubMember }) => (
    <TouchableOpacity
      style={styles.memberCard}
      onPress={() => {
        if (isLeader && item.userId !== user?.id) {
          setSelectedMember(item);
          setShowRoleModal(true);
        }
      }}
      activeOpacity={isLeader && item.userId !== user?.id ? 0.7 : 1}
    >
      <View style={[styles.memberAvatar, item.isCheckedIn && styles.memberAvatarActive]}>
        <Text style={[styles.avatarText, item.isCheckedIn && styles.avatarTextActive]}>
          {item.name[0]}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>{item.name}</Text>
          {item.userId === user?.id && (
            <Text style={styles.meBadge}> (나)</Text>
          )}
        </View>
        <View style={styles.memberMetaRow}>
          <View style={[styles.roleBadge, {
            backgroundColor: item.role === 'LEADER' ? Colors.warning + '20'
              : item.role === 'STAFF' ? '#7C3AED20'
              : Colors.divider,
          }]}>
            <Text style={[styles.roleBadgeText, {
              color: item.role === 'LEADER' ? Colors.warning
                : item.role === 'STAFF' ? '#7C3AED'
                : Colors.textLight,
            }]}>
              {roleLabels[item.role] || item.role}
            </Text>
          </View>
          {item.isCheckedIn && item.playerStatus && (
            <View style={[styles.statusBadge, {
              backgroundColor: (playerStatusColors[item.playerStatus] || Colors.textLight) + '20',
            }]}>
              <View style={[styles.statusDot, {
                backgroundColor: playerStatusColors[item.playerStatus] || Colors.textLight,
              }]} />
              <Text style={[styles.statusBadgeText, {
                color: playerStatusColors[item.playerStatus] || Colors.textLight,
              }]}>
                {playerStatusLabels[item.playerStatus] || item.playerStatus}
              </Text>
            </View>
          )}
        </View>
      </View>
      {!item.isCheckedIn && (
        <Text style={styles.offlineText}>오프라인</Text>
      )}
      {isLeader && item.userId !== user?.id && (
        <Text style={styles.editHint}>...</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: club?.name || '모임' }} />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={loadingSession} onRefresh={onRefresh} />}
        >
          {/* Club info card */}
          {club && (
            <View style={styles.infoCard}>
              <View style={styles.infoLeft}>
                <View style={styles.clubAvatarLarge}>
                  <Text style={styles.clubAvatarText}>{club.name[0]}</Text>
                </View>
                <View>
                  <Text style={styles.clubName}>{club.name}</Text>
                  <Text style={styles.clubMeta}>{currentMembers.length}명</Text>
                </View>
              </View>
              <View style={styles.inviteBox}>
                <Text style={styles.inviteLabel}>초대코드</Text>
                <Text style={styles.inviteCode}>{club.inviteCode}</Text>
              </View>
            </View>
          )}

          {/* Active session banner */}
          {activeSession && (
            <TouchableOpacity
              style={styles.sessionBanner}
              onPress={() => router.push(`/club/${clubId}/session`)}
              activeOpacity={0.7}
            >
              <View style={styles.sessionBannerLeft}>
                <View style={styles.sessionDot} />
                <View>
                  <Text style={styles.sessionBannerTitle}>모임 진행중</Text>
                  <Text style={styles.sessionBannerSub}>
                    {activeSession.facilityName} - 코트 {activeSession.courtIds?.length || 0}개
                  </Text>
                </View>
              </View>
              <View style={styles.sessionBannerBtn}>
                <Text style={styles.sessionBannerBtnText}>모임 관리</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Leader actions */}
          {isLeaderOrStaff && !activeSession && (
            <View style={styles.leaderActions}>
              <TouchableOpacity
                style={styles.startSessionBtn}
                onPress={handleOpenStartModal}
              >
                <Text style={styles.startSessionIcon}>+</Text>
                <Text style={styles.startSessionText}>모임 시작</Text>
              </TouchableOpacity>
              <Text style={styles.startSessionHint}>
                체크인된 시설에서 모임 활동을 시작합니다
              </Text>
            </View>
          )}

          {/* Checked-in members section */}
          {checkedInMembers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                체크인됨 ({checkedInMembers.length})
              </Text>
              {checkedInMembers.map((m) => (
                <View key={m.userId}>
                  {renderMember({ item: m })}
                </View>
              ))}
            </View>
          )}

          {/* Offline members section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {checkedInMembers.length > 0 ? '오프라인' : '전체 멤버'} ({notCheckedInMembers.length})
            </Text>
            {notCheckedInMembers.map((m) => (
              <View key={m.userId}>
                {renderMember({ item: m })}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Start Session Modal */}
        <Modal visible={showStartModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>모임 시작</Text>
                <TouchableOpacity onPress={() => setShowStartModal(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalDesc}>
                {checkinStatus?.facilityName}에서 모임을 시작합니다
              </Text>

              {/* Court selection */}
              <Text style={styles.modalSubtitle}>
                사용할 코트 선택 (선택 안하면 전체)
              </Text>
              <View style={styles.courtGrid}>
                {facilityCourts.map((court) => {
                  const isSelected = selectedCourtIds.includes(court.id);
                  const isMaintenance = court.status === 'MAINTENANCE';
                  return (
                    <TouchableOpacity
                      key={court.id}
                      style={[
                        styles.courtOption,
                        isSelected && styles.courtOptionActive,
                        isMaintenance && styles.courtOptionDisabled,
                      ]}
                      onPress={() => !isMaintenance && toggleCourt(court.id)}
                      disabled={isMaintenance}
                    >
                      <Text style={[
                        styles.courtOptionText,
                        isSelected && styles.courtOptionTextActive,
                        isMaintenance && { color: Colors.textLight },
                      ]}>
                        {court.name}
                      </Text>
                      {isMaintenance && (
                        <Text style={styles.courtMaintenanceText}>점검중</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, isStarting && { opacity: 0.5 }]}
                onPress={handleStartSession}
                disabled={isStarting}
              >
                <Text style={styles.confirmBtnText}>
                  {isStarting ? '시작 중...' : '모임 시작'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Role change modal */}
        <Modal visible={showRoleModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.roleModalContent}>
              <Text style={styles.roleModalTitle}>
                {selectedMember?.name} 역할 변경
              </Text>
              <Text style={styles.roleModalSub}>
                현재: {roleLabels[selectedMember?.role || ''] || selectedMember?.role}
              </Text>

              {['LEADER', 'STAFF', 'MEMBER'].map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.roleOption,
                    selectedMember?.role === role && styles.roleOptionActive,
                  ]}
                  onPress={() => handleChangeRole(role)}
                  disabled={selectedMember?.role === role}
                >
                  <Text style={[
                    styles.roleOptionText,
                    selectedMember?.role === role && styles.roleOptionTextActive,
                  ]}>
                    {roleLabels[role]}
                  </Text>
                  <Text style={styles.roleOptionDesc}>
                    {role === 'LEADER' ? '모임 전체 관리 권한'
                      : role === 'STAFF' ? '모임 운영 및 순번 관리 권한'
                      : '일반 회원'}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.roleCancel}
                onPress={() => { setShowRoleModal(false); setSelectedMember(null); }}
              >
                <Text style={styles.roleCancelText}>{Strings.common.cancel}</Text>
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
  scrollContent: {
    paddingBottom: 40,
  },
  // Info card
  infoCard: {
    backgroundColor: Colors.surface,
    margin: 16,
    marginBottom: 0,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clubAvatarLarge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clubAvatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  clubName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  clubMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  inviteBox: {
    alignItems: 'center',
    backgroundColor: Colors.divider,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inviteLabel: {
    fontSize: 10,
    color: Colors.textLight,
  },
  inviteCode: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 1.5,
  },
  // Session banner
  sessionBanner: {
    backgroundColor: '#EDE9FE',
    margin: 16,
    marginBottom: 0,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7C3AED30',
  },
  sessionBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#7C3AED',
  },
  sessionBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7C3AED',
  },
  sessionBannerSub: {
    fontSize: 12,
    color: '#6D28D9',
    marginTop: 1,
  },
  sessionBannerBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sessionBannerBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // Leader actions
  leaderActions: {
    margin: 16,
    marginBottom: 0,
    alignItems: 'center',
  },
  startSessionBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    justifyContent: 'center',
  },
  startSessionIcon: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  startSessionText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  startSessionHint: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 6,
  },
  // Section
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  // Member card
  memberCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  memberAvatarActive: {
    backgroundColor: Colors.primaryLight,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textLight,
  },
  avatarTextActive: {
    color: Colors.primary,
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  meBadge: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
  },
  memberMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  offlineText: {
    fontSize: 11,
    color: Colors.textLight,
  },
  editHint: {
    fontSize: 18,
    color: Colors.textLight,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  // Modal base
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
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  modalClose: {
    fontSize: 22,
    color: Colors.textLight,
    padding: 4,
  },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  modalSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },
  // Court selection grid
  courtGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  courtOption: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: '45%',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  courtOptionActive: {
    borderColor: '#7C3AED',
    backgroundColor: '#EDE9FE',
  },
  courtOptionDisabled: {
    opacity: 0.4,
  },
  courtOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  courtOptionTextActive: {
    color: '#7C3AED',
  },
  courtMaintenanceText: {
    fontSize: 10,
    color: Colors.textLight,
    marginTop: 2,
  },
  confirmBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  // Role modal
  roleModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 32,
    marginBottom: 'auto',
    marginTop: 'auto',
  },
  roleModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  roleModalSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  roleOption: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  roleOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  roleOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  roleOptionTextActive: {
    color: Colors.primary,
  },
  roleOptionDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  roleCancel: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
  },
  roleCancelText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
