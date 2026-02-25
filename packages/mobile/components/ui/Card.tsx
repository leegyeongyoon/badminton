import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { spacing, radius } from '../../constants/theme';

type CardVariant = 'elevated' | 'outlined' | 'flat';
type AccentPosition = 'left' | 'top';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  accentColor?: string;
  accentPosition?: AccentPosition;
  style?: ViewStyle;
}

export function Card({
  children,
  variant = 'elevated',
  accentColor,
  accentPosition = 'left',
  style,
}: CardProps) {
  const { colors, shadows } = useTheme();

  return (
    <View
      accessible={true}
      accessibilityRole="none"
      style={[
        styles.base,
        { backgroundColor: colors.surface },
        variant === 'elevated' && shadows.md,
        variant === 'outlined' && { borderWidth: 1, borderColor: colors.border },
        accentColor && accentPosition === 'left' && { borderLeftWidth: 4, borderLeftColor: accentColor },
        accentColor && accentPosition === 'top' && { overflow: 'hidden' as const },
        style,
      ]}
    >
      {accentColor && accentPosition === 'top' && (
        <View style={[styles.topAccent, { backgroundColor: accentColor }]} />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.card,
    padding: 18,
  },
  topAccent: {
    height: 4,
    marginTop: -18,
    marginHorizontal: -18,
    marginBottom: 18,
  },
});
