import { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { Text, View, StyleSheet, Platform, Pressable } from 'react-native';
import { BottomTabBar, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { Strings } from '../../constants/strings';
import { Icon, IconName } from '../../components/ui/Icon';
import { useNotificationStore } from '../../store/notificationStore';
import { breakpoints, palette, radius, spacing, typography } from '../../constants/theme';
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

/**
 * Left vertical side-rail nav for tablet/desktop. Mirrors the bottom tab bar's
 * routes, icons, labels and active logic — only the presentation differs.
 * Navigation goes through the same `tabPress` emit + `navigate` path the
 * default bar uses, so expo-router routing is unaffected. Web-safe: no direct
 * window/document access (sizing comes from `useResponsiveLayout`).
 */
function SideRail({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View style={[railStyles.rail, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];

        // Skip routes hidden via `href: null` (expo-router marks them with
        // tabBarItemStyle.display === 'none').
        const itemStyle = StyleSheet.flatten(options.tabBarItemStyle) as { display?: string } | undefined;
        if (itemStyle?.display === 'none') return null;

        const focused = state.index === index;
        const color = focused ? colors.primary : colors.textLight;
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            // Mirror the default bottom tab bar's navigation exactly: dispatch a
            // navigate action targeted at THIS navigator's state key. Using
            // `navigation.navigate(name)` can be swallowed in expo-router's
            // nested layout; this is the reliable path.
            navigation.dispatch({
              ...CommonActions.navigate(route.name, route.params),
              target: state.key,
            });
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            style={({ pressed }) => [
              railStyles.item,
              focused && { backgroundColor: colors.primaryLight },
              pressed && { opacity: 0.7 },
            ]}
          >
            {options.tabBarIcon?.({ focused, color, size: 22 })}
            <Text
              style={[railStyles.label, { color: focused ? colors.primary : colors.textSecondary }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const railStyles = StyleSheet.create({
  rail: {
    width: 200,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  label: {
    ...typography.subtitle2,
    flex: 1,
  },
});

export default function TabsLayout() {
  const { colors } = useTheme();
  const { width } = useResponsiveLayout();
  const useSideRail = width >= breakpoints.tablet;
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const refreshUnread = useNotificationStore((s) => s.refresh);

  useEffect(() => {
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  const tabs = (
    <Tabs
      // On tablet/desktop render a left vertical side-rail; on phone keep the
      // bottom bar exactly as before. Same routes/icons/active logic either way.
      tabBar={(props) => (useSideRail ? <SideRail {...props} /> : <BottomTabBar {...props} />)}
      screenOptions={{
        tabBarPosition: useSideRail ? 'left' : 'bottom',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          elevation: 0, // Android: elevation + Fabric 텍스트 이중 그리기(라벨 겹침) 방지
        },
        // Android Fabric에서 고정 lineHeight + 명시 fontFamily(Roboto)가 탭 라벨을
        // 잘림/겹침으로 만들어, 크기/굵기만 지정(줄높이·폰트패밀리 제거).
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
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
      {/* Tab 1: Home (홈) — club-centric player home */}
      <Tabs.Screen
        name="index"
        options={{
          title: Strings.tabs.home,
          tabBarAccessibilityLabel: A11y.tabs.courts,
          tabBarLabel: Strings.tabs.home,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon name="club" color={color} focused={focused} activeColor={colors.primary} />
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
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ title: '내 정보', href: null }} />
    </Tabs>
  );

  if (Platform.OS === 'web') {
    // Phone-width web stays in a phone-like 480 column (unchanged). At tablet+
    // we un-cage to a comfortable centered shell so the rail + content have
    // room to breathe instead of being squeezed into a 480 phone frame.
    const shellMaxWidth = useSideRail ? 1100 : 480;
    return (
      <View style={[webStyles.outer, { backgroundColor: colors.background }]}>
        <View style={[webStyles.inner, { maxWidth: shellMaxWidth }]}>
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
  },
});
