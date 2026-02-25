import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { WeeklyActivityChart } from '../charts/WeeklyActivityChart';

interface WeeklyTrendsCardProps {
  data: { day: string; count: number }[];
  style?: ViewStyle;
}

export function WeeklyTrendsCard({ data, style }: WeeklyTrendsCardProps) {
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
        주간 이용 현황
      </Text>
      <WeeklyActivityChart data={data} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
});
