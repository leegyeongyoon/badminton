/**
 * CircularProgress - View-based circular progress ring.
 * Uses rotated half-circle overlays to render a progress arc
 * without requiring react-native-svg.
 *
 * Supports animated transitions via react-native-reanimated.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useDerivedValue,
  interpolate,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { palette } from '../../constants/theme';

interface CircularProgressProps {
  /** Diameter of the ring (default 100) */
  size?: number;
  /** Thickness of the ring stroke (default 8) */
  strokeWidth?: number;
  /** Progress value from 0 to 1 */
  progress: number;
  /** Foreground ring color */
  color: string;
  /** Background track color (default light gray) */
  trackColor?: string;
  /** Center content (e.g. countdown text) */
  children?: React.ReactNode;
}

export function CircularProgress({
  size = 100,
  strokeWidth = 8,
  progress,
  color,
  trackColor = palette.slate200,
  children,
}: CircularProgressProps) {
  const halfSize = size / 2;
  const animatedProgress = useSharedValue(progress);

  useEffect(() => {
    animatedProgress.value = withTiming(progress, { duration: 400 });
  }, [progress]);

  // Clamp to [0, 1]
  const clampedProgress = useDerivedValue(() => {
    const p = animatedProgress.value;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  });

  // Right half: rotates from 0 to 180 deg for progress 0..0.5
  const rightRotateStyle = useAnimatedStyle(() => {
    const deg = interpolate(clampedProgress.value, [0, 0.5, 1], [0, 180, 180]);
    return { transform: [{ rotateZ: `${deg}deg` }] };
  });

  // Left half: rotates from 0 to 180 deg for progress 0.5..1
  const leftRotateStyle = useAnimatedStyle(() => {
    const deg = interpolate(clampedProgress.value, [0, 0.5, 1], [0, 0, 180]);
    return { transform: [{ rotateZ: `${deg}deg` }] };
  });

  // Hide left overlay until progress passes 0.5
  const leftOpacityStyle = useAnimatedStyle(() => ({
    opacity: clampedProgress.value > 0.5 ? 1 : 0,
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Track (background ring) */}
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: halfSize,
            borderWidth: strokeWidth,
            borderColor: trackColor,
          },
        ]}
      />

      {/* Right half mask */}
      <View
        style={[
          styles.halfMask,
          {
            width: halfSize,
            height: size,
            left: halfSize,
            overflow: 'hidden',
          },
        ]}
      >
        <Animated.View
          style={[
            styles.halfCircle,
            {
              width: halfSize,
              height: size,
              left: -halfSize,
              borderRadius: halfSize,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              borderWidth: strokeWidth,
              borderRightWidth: 0,
              borderColor: color,
              transformOrigin: 'right',
            },
            rightRotateStyle,
          ]}
        />
      </View>

      {/* Left half mask */}
      <Animated.View
        style={[
          styles.halfMask,
          {
            width: halfSize,
            height: size,
            left: 0,
            overflow: 'hidden',
          },
          leftOpacityStyle,
        ]}
      >
        <Animated.View
          style={[
            styles.halfCircle,
            {
              width: halfSize,
              height: size,
              left: halfSize,
              borderRadius: halfSize,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderWidth: strokeWidth,
              borderLeftWidth: 0,
              borderColor: color,
              transformOrigin: 'left',
            },
            leftRotateStyle,
          ]}
        />
      </Animated.View>

      {/* Center content */}
      {children && (
        <View
          style={[
            styles.center,
            {
              width: size - strokeWidth * 2,
              height: size - strokeWidth * 2,
              borderRadius: (size - strokeWidth * 2) / 2,
              top: strokeWidth,
              left: strokeWidth,
            },
          ]}
        >
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  ring: {
    position: 'absolute',
  },
  halfMask: {
    position: 'absolute',
    top: 0,
  },
  halfCircle: {
    position: 'absolute',
    top: 0,
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
