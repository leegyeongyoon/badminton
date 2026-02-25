import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { createShadow } from '../constants/theme';
import { Strings } from '../constants/strings';
import api from '../services/api';

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data: Record<string, any> | null;
}

const notificationTypeIcons: Record<string, string> = {
  turn_registered: '📝',
  turn_started: '🏸',
  turn_completed: '✅',
  turn_cancelled: '❌',
  turn_promoted: '⬆️',
  game_time_warning: '⏰',
  game_time_expired: '🔔',
  recruitment_created: '📢',
  recruitment_full: '🎉',
  recruitment_expired: '⏳',
  club_session_started: '🏟️',
  club_session_ended: '🔚',
  penalty_applied: '⚠️',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data || []);
    } catch {
      /* silent */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  };

  const markAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    } catch {
      /* silent */
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      /* silent */
    }
  };

  const handleNotificationPress = async (item: Notification) => {
    // Mark as read first
    if (!item.read) {
      await markAsRead(item.id);
    }

    // Deep link based on notification data
    const data = item.data;
    if (!data?.type) return;

    switch (data.type) {
      case 'turn_registered':
      case 'turn_started':
      case 'turn_completed':
      case 'turn_cancelled':
      case 'turn_promoted':
      case 'game_time_warning':
      case 'game_time_expired':
        router.push('/(tabs)/activity');
        break;
      case 'recruitment_created':
      case 'recruitment_full':
      case 'recruitment_expired':
        router.push('/(tabs)');
        break;
      case 'club_session_started':
      case 'club_session_ended':
        if (data.clubId) {
          router.push(`/club/${data.clubId}`);
        } else {
          router.push('/(tabs)');
        }
        break;
      case 'penalty_applied':
        router.push('/(tabs)/profile');
        break;
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}일 전`;
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const renderItem = ({ item }: { item: Notification }) => {
    const icon = item.data?.type
      ? notificationTypeIcons[item.data.type] || '📌'
      : '📌';

    return (
      <TouchableOpacity
        style={[styles.notifCard, !item.read && styles.notifUnread]}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.notifRow}>
          <View style={[styles.notifIconContainer, !item.read && styles.notifIconUnread]}>
            <Text style={styles.notifIcon}>{icon}</Text>
          </View>
          <View style={styles.notifContent}>
            <View style={styles.notifHeader}>
              <Text style={[styles.notifTitle, !item.read && styles.notifTitleUnread]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
            </View>
            <Text style={styles.notifBody} numberOfLines={2}>
              {item.body}
            </Text>
          </View>
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Mark all read header */}
      {unreadCount > 0 && (
        <View style={styles.headerBar}>
          <Text style={styles.headerCount}>
            {unreadCount}{Strings.notification.unreadCount}
          </Text>
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllText}>{Strings.notification.markAllRead}</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          notifications.length === 0 && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Text style={styles.emptyIcon}>🔔</Text>
            </View>
            <Text style={styles.emptyTitle}>{Strings.notification.empty}</Text>
            <Text style={styles.emptyDesc}>
              {Strings.notification.emptyDesc}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  headerCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  markAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
  },
  list: {
    padding: 12,
  },
  listEmpty: {
    flexGrow: 1,
  },
  notifCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    position: 'relative',
    ...createShadow(1, 3, 0.04, 1),
  },
  notifUnread: {
    backgroundColor: '#F0F7FF',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  notifRow: {
    flexDirection: 'row',
    gap: 12,
  },
  notifIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifIconUnread: {
    backgroundColor: Colors.primaryLight,
  },
  notifIcon: {
    fontSize: 16,
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  notifTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  notifTitleUnread: {
    fontWeight: '700',
  },
  notifTime: {
    fontSize: 12,
    color: Colors.textLight,
    marginLeft: 8,
  },
  notifBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  unreadDot: {
    position: 'absolute',
    top: 16,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.divider,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
