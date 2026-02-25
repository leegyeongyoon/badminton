import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { PeakHoursChart } from '../charts/PeakHoursChart';

interface PeakHoursCardProps {
  data: number[][];
  hours: string[];
  days: string[];
  style?: ViewStyle;
}

export function PeakHoursCard({ data, hours, days, style }: PeakHoursCardProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();
  const fadeStyle = useFadeIn();

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: spacing.lg,
          ...shadows.sm,
        },
        fadeStyle,
        style,
      ]}
    >
      <Text
        style={[
          typography.subtitle1,
          { color: colors.text, marginBottom: spacing.md },
        ]}
      >
        피크 시간대
      </Text>
      <PeakHoursChart data={data} hours={hours} days={days} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
