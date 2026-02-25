import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';
import { timingPresets } from '../../utils/animations';

interface OnboardingDotsProps {
  count: number;
  activeIndex: number;
}

/**
 * Animated page indicator dots for the onboarding flow.
 * Active dot is wider (24px) and uses the primary color.
 * Inactive dots are 8px circles with the textLight color.
 */
export function OnboardingDots({ count, activeIndex }: OnboardingDotsProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, index) => (
        <Dot key={index} isActive={index === activeIndex} />
      ))}
    </View>
  );
}

function Dot({ isActive }: { isActive: boolean }) {
  const { colors } = useTheme();

  const animatedStyle = useAnimatedStyle(() => ({
    width: withTiming(isActive ? 24 : 8, timingPresets.normal),
    backgroundColor: withTiming(
      isActive ? colors.primary : colors.textLight,
      timingPresets.normal,
    ),
  }));

  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
