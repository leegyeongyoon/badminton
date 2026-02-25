import { useEffect, useState, useCallback, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Text, View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import { useFacilityStore } from '../../store/facilityStore';
import { useAuthStore } from '../../store/authStore';
import { useSocketToast } from '../../hooks/useSocketToast';
import { useUserRoom } from '../../hooks/useSocket';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon, IconName } from '../../components/ui/Icon';
import api from '../../services/api';
import { palette, radius, spacing, typography } from '../../constants/theme';
import { springPresets } from '../../utils/animations';
import { A11y } from '../../constants/accessibility';

function TabBadge({ count, badgeColor }: { count: number; badgeColor: string }) {
  const scale = useSharedValue(1);
  const prevCount = useRef(count);

  useEffect(() => {
    if (count !== prevCount.current && count > 0) {
      scale.value = withSequence(
        withSpring(1.3, springPresets.bouncy),
        withSpring(1, springPresets.gentle),
      );
    }
    prevCount.current = count;
  }, [count]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (count <= 0) return null;
  return (
    <Animated.View style={[badgeStyles.container, { backgroundColor: badgeColor }, animatedStyle]}>
      <Text style={badgeStyles.text}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

function AnimatedTabIcon({ name, color, focused, activeColor, children }: { name: IconName; color: string; focused: boolean; activeColor: string; children?: React.ReactNode }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused) {
      scale.value = withSequence(
        withSpring(1.15, springPresets.bouncy),
        withSpring(1, springPresets.gentle),
      );
    }
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[{ alignItems: 'center' }, animatedStyle]}>
      <View>
        <Icon name={name} size={22} color={color} />
        {children}
      </View>
      {focused && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: activeColor, marginTop: 2 }} />}
    </Animated.View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -4,
    right: -10,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '700',
  },
});

export default function TabsLayout() {
  const { selectedFacility } = useFacilityStore();
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const facilityName = selectedFacility?.name || '';
  const [unreadCount, setUnreadCount] = useState(0);

  // Socket toast notifications for real-time events
  useUserRoom(user?.id);
  useSocketToast();

  const loadUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications', { params: { limit: 50 } });
      setUnreadCount(
        Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0,
      );
    } catch (e) {
      console.warn('loadUnreadCount failed:', e);
    }
  }, []);

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [loadUnreadCount]);

  const tabs = (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          ...typography.caption,
        },
        tabBarItemStyle: {
          paddingVertical: spacing.xs,
        },
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTitleStyle: {
          color: colors.text,
          fontWeight: '600',
        },
      }}
    >
      {/* Tab 1: Courts (코트) */}
      <Tabs.Screen
        name="index"
        options={{
          title: facilityName || Strings.tabs.courts,
          tabBarAccessibilityLabel: A11y.tabs.courts,
          tabBarLabel: Strings.tabs.courts,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon name="board" color={color} focused={focused} activeColor={colors.primary} />
          ),
        }}
      />
      {/* Tab 2: My Status (내 현황) */}
      <Tabs.Screen
        name="my-status"
        options={{
          title: Strings.tabs.myStatus,
          tabBarAccessibilityLabel: A11y.tabs.myStatus,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon name="activity" color={color} focused={focused} activeColor={colors.primary} />
          ),
        }}
      />
      {/* Tab 3: More (더보기) */}
      <Tabs.Screen
        name="more"
        options={{
          title: Strings.tabs.more,
          tabBarAccessibilityLabel: A11y.tabs.more,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon name="settings" color={color} focused={focused} activeColor={colors.primary}>
              <TabBadge count={unreadCount} badgeColor={colors.danger} />
            </AnimatedTabIcon>
          ),
        }}
      />
      {/* Hidden tabs - files exist but not shown in tab bar */}
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="checkin" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ title: '내 정보', href: null }} />
    </Tabs>
  );

  if (Platform.OS === 'web') {
    return (
      <View style={[webStyles.outer, { backgroundColor: colors.background }]}>
        <View style={webStyles.inner}>
          {tabs}
        </View>
      </View>
    );
  }

  return tabs;
}

const webStyles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
  },
});
