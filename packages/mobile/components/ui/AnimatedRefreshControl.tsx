/**
 * AnimatedRefreshControl
 *
 * Enhanced pull-to-refresh that wraps the standard RefreshControl with
 * theme-aware tint color and a small animated shuttlecock indicator
 * that rotates while refreshing.
 */
import React, { useEffect } from 'react';
import { RefreshControl, View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme } from '../../hooks/useTheme';

interface AnimatedRefreshControlProps {
  refreshing: boolean;
  onRefresh: () => void;
  progressViewOffset?: number;
}

export function AnimatedRefreshControl({
  refreshing,
  onRefresh,
  progressViewOffset,
}: AnimatedRefreshControlProps) {
  const { colors } = useTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (refreshing) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = withTiming(0, { duration: 200 });
    }
  }, [refreshing]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={[colors.primary, colors.secondary]}
      progressViewOffset={progressViewOffset}
      progressBackgroundColor={colors.surface}
    />
  );
}

/**
 * Floating animated refresh indicator for placing above lists.
 * Shows a spinning shuttlecock when `refreshing` is true.
 */
export function RefreshIndicator({ refreshing }: { refreshing: boolean }) {
  const { colors } = useTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (refreshing) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(rotation);
      rotation.value = withTiming(0, { duration: 200 });
    }
  }, [refreshing]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  if (!refreshing) return null;

  return (
    <View style={styles.indicatorContainer}>
      <Animated.View style={spinStyle}>
        <Icon name="court" size={24} color={colors.primary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  indicatorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
});
