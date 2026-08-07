import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useFacilityStore } from '../../store/facilityStore';
import { useClubStore } from '../../store/clubStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useTheme } from '../../hooks/useTheme';
import { useScrollAnimation } from '../../hooks/useScrollAnimation';
import { Strings } from '../../constants/strings';
import { showAlert, showConfirm } from '../../utils/alert';
import { showSuccess } from '../../utils/feedback';
import { Icon } from '../../components/ui/Icon';
import api from '../../services/api';
import { checkinApi } from '../../services/checkin';
import { profileApi } from '../../services/profile';
import { typography, radius, spacing, opacity } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { useFadeIn } from '../../utils/animations';

import { UserProfileCard } from '../../components/settings/UserProfileCard';
import { FacilitySection } from '../../components/settings/FacilitySection';
import { ClubsSection } from '../../components/settings/ClubsSection';
import { MenuSection } from '../../components/settings/MenuSection';
import { ClubModal } from '../../components/settings/ClubModal';
import { SettingsSkeleton } from '../../components/settings/SettingsSkeleton';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status: checkinStatus, fetchStatus } = useCheckinStore();
  const { user, logout } = useAuthStore();
  const { selectedFacility, clearSelectedFacility } = useFacilityStore();
  const { clubs, fetchClubs, createClub, joinClub } = useClubStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [clubName, setClubName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [initialLoaded, setInitialLoaded] = useState(false);
  const facilityId = checkinStatus?.facilityId;
  const fadeInStyle = useFadeIn();
  const { scrollHandler, headerStyle } = useScrollAnimation();

  useEffect(() => {
    Promise.all([
      loadUnreadCount(),
      checkAdminStatus(),
      fetchClubs(),
      loadProfile(),
    ]).finally(() => setInitialLoaded(true));
  }, [facilityId]);

  const loadProfile = async () => {
    try {
      const { data } = await profileApi.getProfile();
      setProfileData(data);
    } catch { /* silent */ }
  };

  // 공용 알림 스토어 갱신(탭 뱃지와 동일 소스). 화면 진입 시 최신 미읽음 수 반영.
  const loadUnreadCount = () => useNotificationStore.getState().refresh();

  const checkAdminStatus = async () => {
    if (!user) return;
    if (user.role === 'FACILITY_ADMIN') { setIsAdmin(true); return; }
    if (facilityId) {
      try {
        const { data } = await api.get('/users/me/admin-facilities');
        setIsAdmin(Array.isArray(data) && data.some((f: any) => f.id === facilityId));
      } catch { setIsAdmin(user.role === 'FACILITY_ADMIN'); }
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

  const handleCreateClub = async (homeFacilityId?: string) => {
    if (!clubName.trim()) return;
    try {
      await createClub(clubName.trim(), undefined, homeFacilityId);
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
    } catch { /* silent */ }
  };

  // Show skeleton on initial load before profile and stats arrive
  if (!initialLoaded && profileData === null) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <SettingsSkeleton />
      </ScrollView>
    );
  }

  return (
    <AnimatedScrollView
      style={[styles.container, { backgroundColor: colors.background }, fadeInStyle]}
      contentContainerStyle={styles.content}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
    >
      <Animated.View style={headerStyle}>
        <UserProfileCard
          user={user}
          profileData={profileData}
          onEditProfile={() => router.push('/(tabs)/profile')}
        />
      </Animated.View>

      {/* 활동 통계는 '내 정보'(프로필) 화면으로 일원화 — 설정 화면에서는 제거.
          설정은 계정/모임/메뉴 위주로 단순하게 유지한다. */}

      {/* Facility management (change gym / checkin-checkout) is an admin concern.
          Regular members/leaders should see settings as a view/account screen,
          so gate this behind the FACILITY_ADMIN role. */}
      {user?.role === 'FACILITY_ADMIN' && (
        <FacilitySection
          facilityName={selectedFacility?.name}
          checkinStatus={checkinStatus ? { facilityName: checkinStatus.facilityName } : null}
          onChangeFacility={clearSelectedFacility}
          onCheckout={handleCheckout}
        />
      )}

      <ClubsSection
        clubs={clubs}
        onCreateClub={() => setShowCreateModal(true)}
        onJoinClub={() => setShowJoinModal(true)}
        onClubPress={(clubId) => router.push(`/club/${clubId}`)}
        onShareInvite={handleShareInvite}
      />

      <MenuSection
        isAdmin={isAdmin}
        unreadCount={0}
        onNavigate={(route) => router.push(route as any)}
      />

      <TouchableOpacity
        style={[styles.logoutButton, { backgroundColor: colors.dangerLight, borderColor: alpha(colors.danger, opacity.border) }]}
        onPress={handleLogout}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={Strings.auth.logout}
      >
        <Icon name="logout" size={18} color={colors.danger} />
        <Text style={[styles.logoutText, { color: colors.danger }]}>{Strings.auth.logout}</Text>
      </TouchableOpacity>

      <View style={styles.appInfo}>
        <Text style={[styles.appInfoText, { color: colors.textLight }]}>{Strings.app.name}</Text>
        <Text style={[styles.versionText, { color: colors.textLight }]}>v{Constants.expoConfig?.version ?? '1.0.2'}</Text>
        <Text
          style={[styles.versionText, { color: colors.primary, marginTop: 6, fontWeight: '600' }]}
          onPress={() => router.push('/guide')}
          accessibilityRole="link"
        >
          앱 사용법
        </Text>
        <Text
          style={[styles.versionText, { color: colors.primary, marginTop: 6, fontWeight: '600' }]}
          onPress={() => router.push('/privacy')}
          accessibilityRole="link"
        >
          개인정보처리방침
        </Text>
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
    </AnimatedScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxxl,
    gap: spacing.lg,
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
