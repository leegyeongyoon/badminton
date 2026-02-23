import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { useFacilityStore } from '../../store/facilityStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showConfirm } from '../../utils/alert';
import api from '../../services/api';

interface MenuItem {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  badge?: string;
  show?: boolean;
}

export default function MoreScreen() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { user, logout } = useAuthStore();
  const { selectedFacility, clearSelectedFacility } = useFacilityStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  const facilityId = checkinStatus?.facilityId;

  useEffect(() => {
    loadUnreadCount();
    checkAdminStatus();
  }, [facilityId]);

  const loadUnreadCount = async () => {
    try {
      const { data } = await api.get('/notifications', { params: { unreadOnly: true } });
      setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0);
    } catch { /* silent */ }
  };

  const checkAdminStatus = async () => {
    if (!user) return;
    if (user.role === 'FACILITY_ADMIN') {
      setIsAdmin(true);
      return;
    }
    // Also check if user is admin for current facility
    if (facilityId) {
      try {
        const { data } = await api.get(`/users/me/admin-facilities`);
        setIsAdmin(Array.isArray(data) && data.some((f: any) => f.id === facilityId));
      } catch {
        setIsAdmin(user.role === 'FACILITY_ADMIN');
      }
    }
  };

  const handleCheckin = () => {
    router.push('/(tabs)/checkin');
  };

  const handleNotifications = () => {
    router.push('/notifications');
  };

  const handleTvDisplay = () => {
    if (!facilityId) {
      return;
    }
    router.push(`/display/${facilityId}`);
  };

  const handleProfile = () => {
    router.push('/(tabs)/profile');
  };

  const handleAdmin = () => {
    router.push('/admin');
  };

  const handleChangeFacility = async () => {
    await clearSelectedFacility();
    // Root layout gating will redirect to facility-select
  };

  const handleLogout = () => {
    showConfirm(
      Strings.auth.logout,
      '로그아웃하시겠습니까?',
      async () => {
        await logout();
        // Root layout gating will redirect to auth
      },
      Strings.auth.logout,
    );
  };

  const menuItems: MenuItem[] = [
    {
      icon: '🏟️',
      label: Strings.facility.change,
      description: selectedFacility
        ? `${selectedFacility.name} (${Strings.facility.changeDescription})`
        : Strings.facility.changeDescription,
      onPress: handleChangeFacility,
    },
    {
      icon: '📷',
      label: '체크인',
      description: checkinStatus
        ? `${checkinStatus.facilityName}에 체크인 중`
        : '시설에 체크인하세요',
      onPress: handleCheckin,
      badge: checkinStatus ? '체크인 중' : undefined,
    },
    {
      icon: '🔔',
      label: '알림',
      description: '순번 및 게임 알림',
      onPress: handleNotifications,
      badge: unreadCount > 0 ? `${unreadCount}` : undefined,
    },
    {
      icon: '👤',
      label: '프로필',
      description: '플레이어 설정 및 통계',
      onPress: handleProfile,
    },
    {
      icon: '📺',
      label: 'TV 디스플레이 모드',
      description: '대형 화면용 코트 현황 표시',
      onPress: handleTvDisplay,
      show: !!facilityId,
    },
  ];

  const visibleMenuItems = menuItems.filter((item) => item.show !== false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User card */}
      <View style={styles.userCard}>
        <View style={styles.userAvatar}>
          <Text style={styles.userAvatarText}>{user?.name?.[0] || '?'}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userPhone}>{user?.phone}</Text>
        </View>
        {checkinStatus && (
          <View style={styles.checkinStatusBadge}>
            <Text style={styles.checkinStatusText}>체크인</Text>
          </View>
        )}
      </View>

      {/* Admin section - prominent card */}
      {isAdmin && (
        <TouchableOpacity style={styles.adminCard} onPress={handleAdmin} activeOpacity={0.8}>
          <View style={styles.adminCardInner}>
            <View style={styles.adminIconContainer}>
              <Text style={styles.adminIcon}>⚙️</Text>
            </View>
            <View style={styles.adminCardInfo}>
              <Text style={styles.adminCardLabel}>{Strings.admin.adminMenu}</Text>
              <Text style={styles.adminCardDesc}>운영, 게임 편성, 코트 관리</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Menu items */}
      <View style={styles.menuSection}>
        {visibleMenuItems.map((item, idx) => (
          <TouchableOpacity
            key={idx}
            style={[
              styles.menuItem,
              idx < visibleMenuItems.length - 1 && styles.menuItemBorder,
            ]}
            onPress={item.onPress}
          >
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuInfo}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.description}</Text>
            </View>
            {item.badge && (
              <View style={styles.menuBadge}>
                <Text style={styles.menuBadgeText}>{item.badge}</Text>
              </View>
            )}
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
        <Text style={styles.logoutButtonText}>{Strings.auth.logout}</Text>
      </TouchableOpacity>

      {/* App info */}
      <View style={styles.appInfoSection}>
        <Text style={styles.appInfoText}>{Strings.app.name}</Text>
        <Text style={styles.versionText}>v1.0.0</Text>
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
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  userPhone: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  checkinStatusBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  checkinStatusText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  menuSection: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  menuIcon: {
    fontSize: 24,
  },
  menuInfo: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  menuDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  menuBadge: {
    backgroundColor: Colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  menuBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  menuArrow: {
    fontSize: 22,
    color: Colors.textLight,
    marginLeft: 4,
  },
  // Admin card
  adminCard: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  adminCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  adminIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminIcon: {
    fontSize: 20,
  },
  adminCardInfo: {
    flex: 1,
  },
  adminCardLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  adminCardDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dangerLight,
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.danger,
  },
  appInfoSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  appInfoText: {
    fontSize: 14,
    color: Colors.textLight,
    fontWeight: '500',
  },
  versionText: {
    fontSize: 12,
    color: Colors.textLight,
    marginTop: 4,
  },
});
