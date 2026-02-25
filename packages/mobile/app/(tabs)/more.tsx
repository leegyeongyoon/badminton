import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useFacilityStore } from '../../store/facilityStore';
import { useClubStore } from '../../store/clubStore';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Icon } from '../../components/ui/Icon';
import api from '../../services/api';
import { checkinApi } from '../../services/checkin';
import { profileApi } from '../../services/profile';
import { typography, radius, spacing, opacity } from '../../constants/theme';
import { alpha } from '../../utils/color';

import { UserProfileCard } from '../../components/settings/UserProfileCard';
import { ClubsSection } from '../../components/settings/ClubsSection';
import { ClubModal } from '../../components/settings/ClubModal';

export default function MoreScreen() {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const { user, logout } = useAuthStore();
  const { selectedFacility, clearSelectedFacility } = useFacilityStore();
  const { clubs, fetchClubs, createClub, joinClub } = useClubStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const facilityId = checkinStatus?.facilityId;

  useEffect(() => {
    Promise.all([
      loadUnreadCount(),
      checkAdminStatus(),
      fetchClubs(),
      loadProfile(),
    ]);
  }, [facilityId]);

  const loadProfile = async () => {
    try {
      const { data } = await profileApi.getProfile();
      setProfileData(data);
    } catch {
      /* silent */
    }
  };

  const loadUnreadCount = async () => {
    try {
      const { data } = await api.get('/notifications', { params: { unreadOnly: true } });
      setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0);
    } catch {
      /* silent */
    }
  };

  const checkAdminStatus = async () => {
    if (!user) return;
    if (user.role === 'FACILITY_ADMIN') {
      setIsAdmin(true);
      return;
    }
    if (facilityId) {
      try {
        const { data } = await api.get('/users/me/admin-facilities');
        setIsAdmin(Array.isArray(data) && data.some((f: any) => f.id === facilityId));
      } catch {
        setIsAdmin(user.role === 'FACILITY_ADMIN');
      }
    }
  };

  const handleCheckout = () => {
    showConfirm('체크아웃', '체크아웃 하시겠습니까?', async () => {
      try {
        await checkinApi.checkOut();
        await fetchStatus();
        showSuccess('체크아웃 되었습니다');
      } catch (err: any) {
        showAlert('오류', err.response?.data?.error || '체크아웃에 실패했습니다');
      }
    });
  };

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
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
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

      {/* Facility management */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>시설 관리</Text>
        {selectedFacility && (
          <View style={styles.facilityInfo}>
            <Text style={[styles.facilityName, { color: colors.textSecondary }]}>
              {selectedFacility.name}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.menuItem} onPress={clearSelectedFacility}>
          <Icon name="court" size={18} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.text }]}>{Strings.facility.change}</Text>
        </TouchableOpacity>
        {checkinStatus && (
          <TouchableOpacity style={styles.menuItem} onPress={handleCheckout}>
            <Icon name="logout" size={18} color={colors.danger} />
            <Text style={[styles.menuItemText, { color: colors.danger }]}>{Strings.checkin.checkout}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Menu items */}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadows.sm]}>
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/notifications')}>
          <Icon name="notification" size={18} color={colors.textSecondary} />
          <Text style={[styles.menuItemText, { color: colors.text }]}>{Strings.notification.title}</Text>
          {unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.danger }]}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/admin')}>
            <Icon name="settings" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>{Strings.admin.dashboard}</Text>
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
          <Text style={[styles.menuItemText, { color: colors.text }]}>테마 및 설정</Text>
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
    </ScrollView>
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
  facilityInfo: {
    marginBottom: spacing.sm,
  },
  facilityName: {
    ...typography.caption,
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
