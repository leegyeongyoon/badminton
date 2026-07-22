import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useClubStore } from '../../store/clubStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Icon } from '../../components/ui/Icon';
import api from '../../services/api';
import { profileApi } from '../../services/profile';
import { operatorRequestApi } from '../../services/operatorRequest';
import type { OperatorRequestResponse } from '@badminton/shared';
import { typography, radius, spacing, opacity } from '../../constants/theme';
import { alpha } from '../../utils/color';

import { UserProfileCard } from '../../components/settings/UserProfileCard';
import { ClubsSection } from '../../components/settings/ClubsSection';
import { ClubModal } from '../../components/settings/ClubModal';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ScreenContainer } from '../../components/ui/ScreenContainer';

// 운영자 신청 상태 → 사용자에게 보여줄 한 줄 라벨.
const OPERATOR_STATUS_LABEL: Record<string, string> = {
  PENDING: '신청 대기중',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
};

export default function MoreScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { user, logout, loadUser } = useAuthStore();
  const { clubs, fetchClubs, createClub, joinClub } = useClubStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [profileData, setProfileData] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  // 운영자 신청 (PLAYER 만 해당)
  const [operatorRequest, setOperatorRequest] = useState<OperatorRequestResponse | null>(null);
  const [showOperatorModal, setShowOperatorModal] = useState(false);
  const [operatorReason, setOperatorReason] = useState('');
  const [submittingOperator, setSubmittingOperator] = useState(false);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isPlayer = user?.role === 'PLAYER';

  // 내가 모임장(LEADER)인 — 또는 최고관리자면 전체 — 모임. 여기서 모임 삭제 가능.
  const managedClubs = clubs.filter(
    (c) => isSuperAdmin || c.isLeader || c.role === 'LEADER',
  );

  // 모임 삭제 흐름은 모임 관리 화면(/club/[id]/manage)으로 이동했음.

  useEffect(() => {
    Promise.all([
      loadUnreadCount(),
      fetchClubs(),
      loadProfile(),
      loadOperatorRequest(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOperatorRequest = async () => {
    // PLAYER 만 신청 상태가 의미 있음. 그 외 권한은 조회하지 않음.
    if (!user || user.role !== 'PLAYER') {
      setOperatorRequest(null);
      return;
    }
    try {
      const { data } = await operatorRequestApi.me();
      setOperatorRequest(data.request);
      // 승인되어 서버 role 이 바뀐 경우 로컬 user 도 갱신해 운영자 메뉴가 보이게.
      if (data.role !== user.role) {
        await loadUser();
      }
    } catch {
      /* silent */
    }
  };

  const handleSubmitOperatorRequest = async () => {
    setSubmittingOperator(true);
    try {
      const { data } = await operatorRequestApi.create(operatorReason.trim() || undefined);
      setOperatorRequest(data);
      setShowOperatorModal(false);
      setOperatorReason('');
      showSuccess('운영자 신청이 접수되었어요');
    } catch (err: any) {
      showAlert(Strings.common.error, err?.response?.data?.error || '운영자 신청에 실패했습니다');
    } finally {
      setSubmittingOperator(false);
    }
  };

  const loadProfile = async () => {
    try {
      const { data } = await profileApi.getProfile();
      setProfileData(data);
    } catch {
      /* silent */
    }
  };

  // 공용 알림 스토어 갱신(탭 뱃지와 동일 소스). 화면 진입 시 최신 미읽음 수 반영.
  const loadUnreadCount = () => useNotificationStore.getState().refresh();

  const handleLogout = () => {
    showConfirm(Strings.auth.logout, '로그아웃하시겠습니까?', async () => {
      await logout();
    }, Strings.auth.logout);
  };

  const handleCreateClub = async () => {
    if (!clubName.trim()) return;
    try {
      await createClub(clubName.trim());
      setClubName('');
      setShowCreateModal(false);
      fetchClubs();
    } catch (err: any) {
      showAlert(Strings.common.error, err.response?.data?.error || '모임 생성에 실패했습니다');
    }
  };

  const handleJoinClub = async () => {
    if (!inviteCode.trim()) return;
    try {
      await joinClub(inviteCode.trim());
      setInviteCode('');
      setShowJoinModal(false);
      fetchClubs();
    } catch (err: any) {
      showAlert(Strings.common.error, err.response?.data?.error || '모임 가입에 실패했습니다');
    }
  };

  const handleShareInvite = async (code: string, name: string) => {
    try {
      await Share.share({ message: `${Strings.app.name} - ${name} 모임에 참여하세요! 초대코드: ${code}` });
    } catch {
      /* silent */
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
    <ScreenContainer>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Profile card */}
      <UserProfileCard
        user={user}
        profileData={profileData}
        onEditProfile={() => router.push('/(tabs)/profile')}
      />

      {/* Clubs section - with game board entry */}
      <ClubsSection
        clubs={clubs}
        onCreateClub={() => setShowCreateModal(true)}
        onJoinClub={() => setShowJoinModal(true)}
        onClubPress={(clubId) => router.push(`/club/${clubId}`)}
        onShareInvite={handleShareInvite}
      />

      {/* 모임 관리 — 모임장(또는 최고관리자)이 자기 모임의 관리 허브로 진입. 탭하면
          클럽 정보 수정 / 멤버·출석·회비 / 모임 삭제가 있는 관리 화면으로 이동. */}
      {managedClubs.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>모임 관리</Text>
          {managedClubs.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.menuItem}
              onPress={() => router.push(`/club/${c.id}/manage`)}
              accessibilityLabel={`${c.name} 관리`}
              activeOpacity={0.7}
            >
              <Icon name="court" size={18} color={colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {c.name}
              </Text>
              <Icon name="chevronRight" size={18} color={colors.textLight} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Menu items */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/notifications')}>
          <Icon name="notification" size={18} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.text }]}>{Strings.notification.title}</Text>
        </TouchableOpacity>

        {/* PLAYER → 운영자 신청. 신청 이력이 있으면 현재 상태를 함께 표시. */}
        {isPlayer && (
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              // PENDING 중이면 다시 신청할 수 없음(서버 409) → 모달 대신 안내만.
              if (operatorRequest?.status === 'PENDING') {
                showAlert('운영자 신청', '신청이 접수되어 검토 중이에요');
                return;
              }
              setShowOperatorModal(true);
            }}
          >
            <Icon name="people" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>운영자 신청</Text>
            {operatorRequest && (
              <Text
                style={[
                  styles.statusBadgeText,
                  {
                    color:
                      operatorRequest.status === 'PENDING'
                        ? colors.warning
                        : operatorRequest.status === 'REJECTED'
                        ? colors.danger
                        : colors.primary,
                  },
                ]}
              >
                {OPERATOR_STATUS_LABEL[operatorRequest.status]}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* SUPER_ADMIN → 운영자 신청 관리 화면. */}
        {isSuperAdmin && (
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/admin/operator-requests')}>
            <Icon name="people" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>운영자 신청 관리</Text>
          </TouchableOpacity>
        )}

        {/* SUPER_ADMIN → 운영 지표 대시보드(트래픽·접속·활동량). */}
        {isSuperAdmin && (
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/admin/metrics')}>
            <Icon name="stats" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>운영 지표 대시보드</Text>
          </TouchableOpacity>
        )}

        {/* SUPER_ADMIN → 모임별 멤버(누가 어느 모임에 가입했나). */}
        {isSuperAdmin && (
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/admin/clubs')}>
            <Icon name="people" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>모임별 멤버</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* App settings */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>앱 설정</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(tabs)/settings')}
        >
          <Icon name="settings" size={18} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.text }]}>설정</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={[styles.logoutButton, { backgroundColor: colors.dangerLight, borderColor: alpha(colors.danger, opacity.border) }]}
        onPress={handleLogout}
        activeOpacity={0.7}
      >
        <Icon name="logout" size={18} color={colors.danger} />
        <Text style={[styles.logoutText, { color: colors.danger }]}>{Strings.auth.logout}</Text>
      </TouchableOpacity>

      <View style={styles.appInfo}>
        <Text style={[styles.appInfoText, { color: colors.textLight }]}>{Strings.app.name}</Text>
        <Text style={[styles.versionText, { color: colors.textLight }]}>v2.0.0</Text>
      </View>

      <ClubModal
        mode="create"
        visible={showCreateModal}
        value={clubName}
        onChangeText={setClubName}
        onConfirm={handleCreateClub}
        onCancel={() => { setShowCreateModal(false); setClubName(''); }}
      />
      <ClubModal
        mode="join"
        visible={showJoinModal}
        value={inviteCode}
        onChangeText={setInviteCode}
        onConfirm={handleJoinClub}
        onCancel={() => { setShowJoinModal(false); setInviteCode(''); }}
      />

      {/* 운영자 신청 모달 (사유 선택) */}
      <Modal
        visible={showOperatorModal}
        onClose={() => { setShowOperatorModal(false); setOperatorReason(''); }}
        title="운영자 신청"
        actions={
          <View style={styles.modalActions}>
            <Button
              title={Strings.common.cancel}
              onPress={() => { setShowOperatorModal(false); setOperatorReason(''); }}
              variant="outline"
              size="md"
            />
            <Button
              title="신청하기"
              onPress={handleSubmitOperatorRequest}
              variant="primary"
              size="md"
              loading={submittingOperator}
            />
          </View>
        }
      >
        <Text style={[styles.modalDesc, { color: colors.textSecondary }]}>
          운영자가 되면 모임을 만들고 운영할 수 있어요. 최고관리자 승인 후 권한이 부여됩니다.
        </Text>
        <Input
          label="신청 사유 (선택)"
          placeholder="예: 우리 동호회 모임을 운영하고 싶어요"
          value={operatorReason}
          onChangeText={setOperatorReason}
          maxLength={300}
        />
      </Modal>
    </ScrollView>
    </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxxl, gap: spacing.lg },
  section: {
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...typography.subtitle2,
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  menuItemText: {
    ...typography.body1,
    flex: 1,
  },
  statusBadgeText: {
    ...typography.caption,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  modalDesc: {
    ...typography.body2,
    marginBottom: spacing.md,
  },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  logoutButton: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
  },
  logoutText: {
    ...typography.subtitle1,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  appInfoText: {
    ...typography.body2,
    fontWeight: '600',
  },
  versionText: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});
