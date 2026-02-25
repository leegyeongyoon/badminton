import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

type StatusDotSize = 'sm' | 'md' | 'lg';

interface StatusDotProps {
  color: string;
  size?: StatusDotSize;
  pulse?: boolean;
}

const sizeMap: Record<StatusDotSize, number> = {
  sm: 6,
  md: 8,
  lg: 12,
};

export function StatusDot({ color, size = 'md', pulse = false }: StatusDotProps) {
  const s = sizeMap[size];

  // Dot opacity pulse
  const dotOpacity = useSharedValue(1);
  // Ring expand effect
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      // Dot opacity pulsing
      dotOpacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
      // Expanding ring: scale up from 1 to 2.5 while fading out
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(2.5, { duration: 1200, easing: Easing.out(Easing.cubic) }),
        ),
        -1,
        false,
      );
      ringOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 0 }),
          withTiming(0, { duration: 1200, easing: Easing.out(Easing.cubic) }),
        ),
        -1,
        false,
      );
    } else {
      dotOpacity.value = withTiming(1, { duration: 200 });
      ringScale.value = 1;
      ringOpacity.value = 0;
    }
  }, [pulse, dotOpacity, ringScale, ringOpacity]);

  const dotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  const ringAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  if (pulse) {
    return (
      <View style={[styles.container, { width: s * 3, height: s * 3 }]}>
        {/* Expanding ring */}
        <Animated.View
          style={[
            styles.ring,
            {
              width: s,
              height: s,
              borderRadius: s / 2,
              backgroundColor: color,
            },
            ringAnimatedStyle,
          ]}
        />
        {/* Core dot */}
        <Animated.View
          style={[
            styles.dot,
            {
              width: s,
              height: s,
              borderRadius: s / 2,
              backgroundColor: color,
            },
            dotAnimatedStyle,
          ]}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.staticDot,
        { width: s, height: s, borderRadius: s / 2, backgroundColor: color },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
  },
  staticDot: {},
});
