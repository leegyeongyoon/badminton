import React, { useEffect } from 'react';
import { Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, typography, spacing } from '../../constants/theme';
import { Icon } from '../ui/Icon';

interface NetworkStatusBarProps {
  isConnected: boolean;
  isReconnecting?: boolean;
}

export function NetworkStatusBar({ isConnected, isReconnecting = false }: NetworkStatusBarProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-80);

  const shouldShow = !isConnected || isReconnecting;

  useEffect(() => {
    if (shouldShow) {
      translateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      // Delay hide slightly so user sees the bar before it disappears
      translateY.value = withDelay(
        400,
        withTiming(-80, {
          duration: 300,
          easing: Easing.in(Easing.cubic),
        }),
      );
    }
  }, [shouldShow]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backgroundColor = isReconnecting ? palette.amber600 : palette.red500;
  const message = isReconnecting ? '재연결 중...' : '인터넷 연결 없음';
  const iconName = isReconnecting ? 'warning' : 'error';

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor, paddingTop: insets.top + spacing.xs, pointerEvents: 'none' as const },
        animatedStyle,
      ]}
    >
      <Icon name={iconName} size={16} color={palette.white} />
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10000,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  text: {
    color: palette.white,
    ...typography.caption,
    fontWeight: '700',
  },
});
