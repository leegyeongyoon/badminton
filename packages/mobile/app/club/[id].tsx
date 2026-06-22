import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useClubStore } from '../../store/clubStore';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { clubSessionApi } from '../../services/clubSession';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { getItem, setItem } from '../../services/storage';
import { AttendanceLeaderboard } from '../../components/club/AttendanceLeaderboard';

interface ClubMember {
  userId: string;
  name: string;
  role: string;
  isCheckedIn: boolean;
  facilityId: string | null;
  playerStatus: string | null;
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
  const { status: checkinStatus, checkOut, fetchStatus, checkIn } = useCheckinStore();
  const { user, isGuest } = useAuthStore();

  const [checkingOut, setCheckingOut] = useState(false);

  const [activeSession, setActiveSession] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ClubMember | null>(null);
  // 정모 시작 시 등록할 "코트 수" (기본 4). 각 정모는 자기 전용 코트 1..N을 가진다.
  const [courtCountInput, setCourtCountInput] = useState('4');
  const [isStarting, setIsStarting] = useState(false);

  const club = clubs.find((c) => c.id === clubId);
  const myMembership = currentMembers.find((m) => m.userId === user?.id);
  const isLeaderOrStaff = myMembership?.role === 'LEADER' || myMembership?.role === 'STAFF';
  const isLeader = myMembership?.role === 'LEADER';
  const checkedInFacilityId = checkinStatus?.facilityId;
  // Am I currently checked in? Prefer the per-member flag from the club roster
  // (reflects this club's 정모), falling back to the global check-in status.
  const isCheckedIn = !!myMembership?.isCheckedIn || !!checkinStatus;

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

  // Auto check-in on entering an ACTIVE 정모: a club member who opens the 정모 is
  // checked in automatically (NO geofence — per product decision). Done at most
  // ONCE per 정모 (persisted), so a member who later checks out is NOT auto
  // re-checked-in — they re-check-in with the manual 체크인 button. Guests and
  // non-members are excluded.
  const autoTriedRef = useRef<string | null>(null);
  const [autoCheckMsg] = useState<string | null>(null);
  const AUTO_ATTEND_KEY = 'badminton_auto_attended_sessions';
  useEffect(() => {
    const sid = activeSession?.id;
    if (!sid || !user || isGuest || isCheckedIn || !myMembership) return;
    if (autoTriedRef.current === sid) return;
    autoTriedRef.current = sid;
    (async () => {
      let done: string[] = [];
      try { done = JSON.parse((await getItem(AUTO_ATTEND_KEY)) || '[]'); } catch { done = []; }
      if (done.includes(sid)) return; // already auto-attended once (e.g. then checked out)
      try {
        await clubSessionApi.attend(sid); // unconditional check-in (no geofence)
        try { await setItem(AUTO_ATTEND_KEY, JSON.stringify([...done, sid])); } catch { /* noop */ }
        showSuccess('정모 참여 — 자동 체크인됐어요');
        await Promise.all([fetchStatus(), fetchMembers(clubId)]);
      } catch { /* non-fatal — 수동 체크인 버튼 유지 */ }
    })();
  }, [activeSession?.id, user, isGuest, isCheckedIn, myMembership, clubId]);

  const onRefresh = useCallback(async () => {
    if (clubId) {
      await Promise.all([
        fetchMembers(clubId),
        loadActiveSession(),
      ]);
    }
  }, [clubId]);

  // Open the start modal to register the 코트 수 (default 4) for this 정모.
  const handleOpenStartModal = () => {
    if (!checkedInFacilityId) {
      showAlert('알림', '체크인 후에 모임을 시작할 수 있습니다');
      return;
    }
    setCourtCountInput('4');
    setShowStartModal(true);
  };

  // Start the 정모 with a court COUNT. The server creates this 정모's OWN courts
  // (코트 1 … 코트 N) — fully independent of any other 모임's courts.
  const handleStartSession = async (courtCount?: number) => {
    if (!clubId || !checkedInFacilityId) return;
    setIsStarting(true);
    try {
      const { data: newSession } = await clubSessionApi.start(clubId, {
        facilityId: checkedInFacilityId,
        ...(courtCount && courtCount > 0 ? { courtCount } : {}),
      });
      setShowStartModal(false);
      setActiveSession(newSession);
      // 정모 시작하면 바로 운영판으로
      router.push(`/session/${newSession.id}/operate`);
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '정모 시작에 실패했습니다');
    } finally {
      setIsStarting(false);
    }
  };

  // One-tap 정모 start: defaults to 4 courts (코트 1~4) for this 정모.
  const handleQuickStartSession = async () => {
    if (!checkedInFacilityId) {
      showAlert('알림', '체크인 후에 정모를 시작할 수 있습니다');
      return;
    }
    await handleStartSession(4);
  };

  // Player self check-out. Confirms, calls the existing checkinStore.checkOut()
  // (POST /checkin/checkout), then refreshes both the global check-in status and
  // this club's roster so the "참석 중" indicator / 체크인 button update.
  const handleCheckOut = () => {
    showConfirm(
      '체크아웃',
      '정모에서 체크아웃할까요? 대기 중인 순번은 취소됩니다.',
      async () => {
        setCheckingOut(true);
        try {
          await checkOut();
          await Promise.all([
            fetchStatus(),
            clubId ? fetchMembers(clubId) : Promise.resolve(),
          ]);
        } catch (err: any) {
          showAlert(Strings.common.error, err?.response?.data?.error || '체크아웃에 실패했습니다');
        } finally {
          setCheckingOut(false);
        }
      },
      '체크아웃',
      Strings.common.cancel,
      'danger',
    );
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
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={loadingSession} onRefresh={onRefresh} />}
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
              <TouchableOpacity
                style={styles.inviteBox}
                onPress={() => router.push(`/club/${clubId}/qr`)}
                activeOpacity={0.7}
                accessibilityLabel="모임 참여 QR 보기"
              >
                <Text style={styles.inviteLabel}>초대코드</Text>
                <Text style={styles.inviteCode}>{club.inviteCode}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 채팅 / 건의 — 모든 모임원이 사용. 짝 요청(○○랑 같이 치고 싶어요)도 여기서. */}
          <View style={styles.chatButtonWrap}>
            <TouchableOpacity
              style={styles.chatButton}
              onPress={() => router.push(`/club/${clubId}/chat`)}
              activeOpacity={0.85}
              accessibilityLabel="채팅 건의"
            >
              <Text style={styles.chatButtonText}>💬 채팅 / 건의 (짝 요청)</Text>
            </TouchableOpacity>
          </View>

          {/* 모임 참여 QR — 스캔하면 모임에 참여. 관리자(리더/운영진)만 노출. */}
          {isLeaderOrStaff && (
            <View style={styles.qrButtonWrap}>
              <TouchableOpacity
                style={styles.qrButton}
                onPress={() => router.push(`/club/${clubId}/qr`)}
                activeOpacity={0.85}
                accessibilityLabel="모임 참여 QR"
              >
                <Text style={styles.qrButtonText}>모임 참여 QR</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Active session banner.
              • LEADER/STAFF: the management banner (→ 턴 관리) + quick actions
                (운영판 / 턴 관리).
              • Regular player: a clean, prominent block — 체크인 (if not yet
                checked in) + 게임 현황 보기 (read-only board). No 관리 UI. */}
          {activeSession && (
            isLeaderOrStaff ? (
              <View style={styles.sessionBannerWrap}>
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

                {/* Quick actions (operator only) */}
                <View style={styles.quickActions}>
                  <TouchableOpacity
                    style={styles.quickActionBtn}
                    onPress={() => router.push(`/session/${activeSession.id}/operate`)}
                  >
                    <Text style={styles.quickActionText}>운영판</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.quickActionBtn}
                    onPress={() => router.push(`/club/${clubId}/session`)}
                  >
                    <Text style={styles.quickActionText}>턴 관리</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.playerSessionWrap}>
                <View style={styles.playerSessionHeader}>
                  <View style={styles.sessionDot} />
                  <Text style={styles.playerSessionTitle}>모임 진행중</Text>
                  <Text style={styles.playerSessionSub}>
                    {activeSession.facilityName} · 코트 {activeSession.courtIds?.length || 0}개
                  </Text>
                </View>

                {/* 체크인 — 아직 체크인 안 했을 때만 (가장 눈에 띄게).
                    네이티브에서는 GPS 지오펜스(100m)가 적용됨. 웹은 GPS가 없어
                    위치 오류가 날 수 있음(기존 동작 유지). */}
                {!isCheckedIn && (
                  <>
                    <TouchableOpacity
                      style={styles.playerCheckinBtn}
                      onPress={() => router.push(`/checkin-modal?clubSessionId=${activeSession.id}`)}
                      activeOpacity={0.85}
                      accessibilityLabel="체크인"
                    >
                      <Text style={styles.playerCheckinText}>체크인</Text>
                    </TouchableOpacity>
                    {!!autoCheckMsg && (
                      <Text style={styles.autoCheckHint}>📍 {autoCheckMsg}</Text>
                    )}
                  </>
                )}

                {/* 체크인 됨 → "✓ 참석 중" 표시 + 체크아웃 버튼 */}
                {isCheckedIn && (
                  <View style={styles.attendingRow}>
                    <View style={styles.attendingBadge}>
                      <Text style={styles.attendingText}>✓ 참석 중</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.playerCheckoutBtn, checkingOut && { opacity: 0.6 }]}
                      onPress={handleCheckOut}
                      disabled={checkingOut}
                      activeOpacity={0.85}
                      accessibilityLabel="체크아웃"
                    >
                      <Text style={styles.playerCheckoutText}>
                        {checkingOut ? '처리 중...' : '체크아웃'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* 게임 현황 보기 — 읽기 전용 보드. 체크인 여부와 무관하게 항상
                    노출(정모가 진행 중이면 모임원 누구나 볼 수 있어야 함). */}
                <TouchableOpacity
                  style={[styles.playerBoardBtn, isCheckedIn && styles.playerBoardBtnPrimary]}
                  onPress={() => router.push(`/session/${activeSession.id}/board`)}
                  activeOpacity={0.85}
                  accessibilityLabel="게임 현황 보기"
                >
                  <Text style={[styles.playerBoardText, isCheckedIn && styles.playerBoardTextPrimary]}>
                    게임 현황 보기
                  </Text>
                </TouchableOpacity>
              </View>
            )
          )}

          {/* Leader actions — one-tap 정모 start (no scheduling required) */}
          {isLeaderOrStaff && !activeSession && (
            <View style={styles.leaderActions}>
              <TouchableOpacity
                style={[styles.startSessionBtn, isStarting && { opacity: 0.6 }]}
                onPress={handleQuickStartSession}
                disabled={isStarting}
              >
                <Text style={styles.startSessionIcon}>{isStarting ? '' : '▶'}</Text>
                <Text style={styles.startSessionText}>
                  {isStarting ? '시작 중...' : '오늘 정모 시작'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.startSessionHint}>
                체크인된 시설에서 바로 정모를 시작하고 출석을 받습니다
              </Text>
              <TouchableOpacity onPress={handleOpenStartModal} disabled={isStarting}>
                <Text style={styles.courtPickLink}>코트 선택해서 시작</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 출석왕 leaderboard (visible to every club member) */}
          {clubId && <AttendanceLeaderboard clubId={clubId} />}

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
                <Text style={styles.modalTitle}>정모 시작</Text>
                <TouchableOpacity onPress={() => setShowStartModal(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalDesc}>
                {checkinStatus?.facilityName}에서 정모를 시작합니다
              </Text>

              {/* 코트 수 — 이 정모 전용 코트 1..N을 만든다 (다른 모임과 독립). */}
              <Text style={styles.modalSubtitle}>코트 수</Text>
              <View style={styles.courtCountRow}>
                <TouchableOpacity
                  style={styles.courtCountBtn}
                  onPress={() => setCourtCountInput((v) => String(Math.max(1, (parseInt(v, 10) || 1) - 1)))}
                  accessibilityLabel="코트 수 줄이기"
                >
                  <Text style={styles.courtCountBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.courtCountInput}
                  value={courtCountInput}
                  onChangeText={(t) => setCourtCountInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="코트 수"
                />
                <TouchableOpacity
                  style={styles.courtCountBtn}
                  onPress={() => setCourtCountInput((v) => String(Math.min(30, (parseInt(v, 10) || 0) + 1)))}
                  accessibilityLabel="코트 수 늘리기"
                >
                  <Text style={styles.courtCountBtnText}>＋</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.courtCountHint}>
                이 정모 전용 코트(코트 1~{Math.max(1, parseInt(courtCountInput, 10) || 1)})가 만들어져요. 운영 중에 추가/삭제할 수 있어요.
              </Text>

              <TouchableOpacity
                style={[styles.confirmBtn, isStarting && { opacity: 0.5 }]}
                onPress={() => handleStartSession(Math.max(1, parseInt(courtCountInput, 10) || 4))}
                disabled={isStarting}
              >
                <Text style={styles.confirmBtnText}>
                  {isStarting ? '시작 중...' : '정모 시작'}
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
  sessionBannerWrap: {
    margin: 16,
    marginBottom: 0,
    gap: 8,
  },
  sessionBanner: {
    backgroundColor: '#EDE9FE',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7C3AED30',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
  },
  quickActionBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  quickActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
  // 채팅 / 건의 버튼 (모든 모임원)
  chatButtonWrap: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  chatButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#7C3AED',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  // 모임 참여 QR 버튼
  qrButtonWrap: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  qrButton: {
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
  },
  qrButtonText: {
    color: '#7C3AED',
    fontSize: 15,
    fontWeight: '700',
  },
  // Player active-session block (clean, no management UI)
  playerSessionWrap: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#EDE9FE',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#7C3AED30',
    padding: 16,
    gap: 12,
  },
  playerSessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerSessionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#7C3AED',
  },
  playerSessionSub: {
    fontSize: 12,
    color: '#6D28D9',
    flex: 1,
  },
  playerCheckinBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  playerCheckinText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  autoCheckHint: {
    marginTop: 8,
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 12.5,
  },
  // 참석 중 표시 + 체크아웃 (한 줄)
  attendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attendingBadge: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.secondary,
  },
  attendingText: {
    color: Colors.secondary,
    fontSize: 16,
    fontWeight: '800',
  },
  playerCheckoutBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.danger,
    backgroundColor: Colors.surface,
  },
  playerCheckoutText: {
    color: Colors.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  playerBoardBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    backgroundColor: Colors.surface,
  },
  // When already checked in, the board button becomes the primary CTA.
  playerBoardBtnPrimary: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  playerBoardText: {
    color: '#7C3AED',
    fontSize: 16,
    fontWeight: '700',
  },
  playerBoardTextPrimary: {
    color: '#fff',
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
  courtPickLink: {
    fontSize: 13,
    color: '#7C3AED',
    fontWeight: '600',
    marginTop: 10,
    textDecorationLine: 'underline',
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
  // 코트 수 입력 (스테퍼)
  courtCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  courtCountBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDE9FE',
  },
  courtCountBtnText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#7C3AED',
  },
  courtCountInput: {
    minWidth: 72,
    height: 56,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  courtCountHint: {
    fontSize: 12,
    color: Colors.textLight,
    textAlign: 'center',
    marginBottom: 20,
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
