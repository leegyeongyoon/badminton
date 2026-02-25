/**
 * ParallaxHeader
 *
 * A scroll-driven parallax header. The title moves at 0.5x scroll speed,
 * background fades as user scrolls, and the header collapses to a minimum height.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';

interface ParallaxHeaderProps {
  title: string;
  subtitle?: string;
  height?: number;
  scrollY: SharedValue<number>;
  backgroundColor?: string;
}

const MIN_HEIGHT = 0;

export function ParallaxHeader({
  title,
  subtitle,
  height = 120,
  scrollY,
  backgroundColor,
}: ParallaxHeaderProps) {
  const { colors } = useTheme();
  const bgColor = backgroundColor || colors.surface;

  const containerStyle = useAnimatedStyle(() => {
    const h = interpolate(
      scrollY.value,
      [0, height],
      [height, MIN_HEIGHT],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      scrollY.value,
      [0, height * 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return {
      height: h,
      opacity,
    };
  });

  const titleStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [0, height],
      [0, -height * 0.5],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY }],
    };
  });

  return (
    <Animated.View style={[styles.container, { backgroundColor: bgColor }, containerStyle]}>
      <Animated.View style={[styles.content, titleStyle]}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    marginBottom: spacing.lg,
  },
  content: {
    gap: spacing.xs,
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body2,
  },
});
