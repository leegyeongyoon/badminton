import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { springPresets } from '../../utils/animations';

type BadgeVariant = 'filled' | 'outline' | 'dot';
type BadgeColor = 'primary' | 'secondary' | 'danger' | 'warning' | 'info' | 'success' | 'neutral';

interface BadgeProps {
  label?: string;
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: 'sm' | 'md';
  accessibilityLabel?: string;
}

export function Badge({ label, variant = 'filled', color = 'primary', size = 'sm', accessibilityLabel: a11yLabel }: BadgeProps) {
  const { colors } = useTheme();

  const colorMap: Record<BadgeColor, { bg: string; text: string; border: string; dot: string }> = {
    primary: { bg: colors.primaryLight, text: colors.primary, border: colors.primary, dot: colors.primary },
    secondary: { bg: colors.secondaryLight, text: colors.secondary, border: colors.secondary, dot: colors.secondary },
    danger: { bg: colors.dangerLight, text: colors.danger, border: colors.danger, dot: colors.danger },
    warning: { bg: colors.warningLight, text: colors.warning, border: colors.warning, dot: colors.warning },
    info: { bg: colors.infoLight, text: colors.info, border: colors.info, dot: colors.info },
    success: { bg: colors.secondaryLight, text: colors.secondary, border: colors.secondary, dot: colors.secondary },
    neutral: { bg: colors.divider, text: colors.textSecondary, border: colors.border, dot: colors.textLight },
  };

  const c = colorMap[color];
  const isSm = size === 'sm';

  // Entry animation: scale from 0.8 to 1.0
  const scale = useSharedValue(0.8);
  const prevLabelRef = useRef(label);

  useEffect(() => {
    // Mount animation
    scale.value = withSpring(1, springPresets.bouncy);
  }, [scale]);

  useEffect(() => {
    // Bounce on label change (skip initial mount)
    if (prevLabelRef.current !== label) {
      prevLabelRef.current = label;
      scale.value = withSequence(
        withTiming(1.15, { duration: 100 }),
        withSpring(1, springPresets.bouncy),
      );
    }
  }, [label, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (variant === 'dot') {
    return (
      <Animated.View style={[styles.dotContainer, animatedStyle]} accessibilityLabel={a11yLabel || label}>
        <View style={[styles.dot, { backgroundColor: c.dot }]} />
        {label && <Text style={[styles.dotLabel, { color: c.text }]}>{label}</Text>}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.badge,
        {
          backgroundColor: variant === 'filled' ? c.bg : 'transparent',
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: c.border,
          paddingHorizontal: isSm ? spacing.sm : spacing.smd,
          paddingVertical: isSm ? 3 : 5,
        },
        animatedStyle,
      ]}
      accessibilityLabel={a11yLabel || label}
    >
      <Text style={[styles.text, { color: c.text, fontSize: isSm ? 11 : 13 }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.md,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '700',
  },
  dotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
});
