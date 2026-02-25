import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { spacing } from '../../constants/theme';

interface DividerProps {
  spacing?: number;
  color?: string;
}

export function Divider({ spacing: s = spacing.lg, color }: DividerProps) {
  const { colors } = useTheme();
  const dividerColor = color || colors.divider;

  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: dividerColor, marginVertical: s },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
  },
});
