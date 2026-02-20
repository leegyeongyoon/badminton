import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useCheckinStore } from '../../store/checkinStore';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/colors';
import { Strings } from '../../constants/strings';
import { showAlert } from '../../utils/alert';

interface MenuItem {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  badge?: string;
}

export default function MoreScreen() {
  const router = useRouter();
  const { status: checkinStatus } = useCheckinStore();
  const { user } = useAuthStore();

  const facilityId = checkinStatus?.facilityId;

  const handleCheckin = () => {
    router.push('/(tabs)/profile');
  };

  const handleNotifications = () => {
    showAlert('알림', '알림 기능은 준비 중입니다');
  };

  const handleTvDisplay = () => {
    if (!facilityId) {
      showAlert('알림', '체크인 후 TV 디스플레이 모드를 사용할 수 있습니다');
      return;
    }
    router.push(`/display/${facilityId}`);
  };

  const handleProfile = () => {
    router.push('/(tabs)/profile');
  };

  const menuItems: MenuItem[] = [
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
      description: '게임 호출 및 매칭 알림',
      onPress: handleNotifications,
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
    },
  ];

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
            <Text style={styles.checkinStatusText}>📍 체크인</Text>
          </View>
        )}
      </View>

      {/* Menu items */}
      <View style={styles.menuSection}>
        {menuItems.map((item, idx) => (
          <TouchableOpacity
            key={idx}
            style={[
              styles.menuItem,
              idx < menuItems.length - 1 && styles.menuItemBorder,
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
    backgroundColor: Colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  menuBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  menuArrow: {
    fontSize: 22,
    color: Colors.textLight,
    marginLeft: 4,
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
