import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { radius as themeRadius } from '../../constants/theme';

// ─── Shared shimmer hook (reanimated) ───────────────────────
function useShimmer(delay: number = 0) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    const shimmerAnimation = withRepeat(
      withSequence(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    opacity.value = delay > 0 ? withDelay(delay, shimmerAnimation) : shimmerAnimation;
  }, [opacity, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return animatedStyle;
}

// ─── Base Skeleton ─────────────────────────────────────────
interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  delay?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = themeRadius.md,
  delay = 0,
  style,
}: SkeletonProps) {
  const { colors } = useTheme();
  const shimmerStyle = useShimmer(delay);

  return (
    <Animated.View
      style={[
        { backgroundColor: colors.divider },
        {
          width: width as DimensionValue,
          height,
          borderRadius,
        },
        style,
        shimmerStyle,
      ]}
    />
  );
}

// ─── SkeletonGroup (automatic stagger) ──────────────────────
interface SkeletonGroupProps {
  children: React.ReactNode;
  staggerDelay?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonGroup({ children, staggerDelay = 80, style }: SkeletonGroupProps) {
  return (
    <View style={style}>
      {React.Children.map(children, (child, index) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            delay: index * staggerDelay,
          });
        }
        return child;
      })}
    </View>
  );
}

// ─── SkeletonLine (text placeholder) ───────────────────────
interface SkeletonLineProps {
  width?: number | string;
  height?: number;
  delay?: number;
  style?: ViewStyle;
}

export function SkeletonLine({
  width = '100%',
  height = 14,
  delay = 0,
  style,
}: SkeletonLineProps) {
  return (
    <Skeleton
      width={width}
      height={height}
      borderRadius={themeRadius.xs}
      delay={delay}
      style={style}
    />
  );
}

// ─── SkeletonCircle (avatar placeholder) ───────────────────
interface SkeletonCircleProps {
  size?: number;
  delay?: number;
  style?: ViewStyle;
}

export function SkeletonCircle({ size = 40, delay = 0, style }: SkeletonCircleProps) {
  return (
    <Skeleton
      width={size}
      height={size}
      borderRadius={size / 2}
      delay={delay}
      style={style}
    />
  );
}

// ─── SkeletonRect (card/box placeholder) ───────────────────
interface SkeletonRectProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  delay?: number;
  style?: ViewStyle;
}

export function SkeletonRect({
  width = '100%',
  height = 60,
  borderRadius = themeRadius.xl,
  delay = 0,
  style,
}: SkeletonRectProps) {
  return (
    <Skeleton width={width} height={height} borderRadius={borderRadius} delay={delay} style={style} />
  );
}
