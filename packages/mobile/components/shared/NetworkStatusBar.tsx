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
  // -200: 노치/다이내믹아일랜드 아이폰은 바 높이(insets.top+내용)가 80보다 커서 -80이면
  // 약 20px가 상단에 계속 삐져나온다(빨간 띠). 넉넉히 -200으로 완전히 숨긴다.
  const translateY = useSharedValue(-200);

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
        withTiming(-200, {
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
