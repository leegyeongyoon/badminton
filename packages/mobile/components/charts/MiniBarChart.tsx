/**
 * MiniBarChart - Compact 7-day bar chart using View-based rendering.
 * No external chart library needed.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';

interface MiniBarChartProps {
  data: number[];
  labels?: string[];
  color?: string;
  height?: number;
  style?: ViewStyle;
}

const BAR_GAP = 4;
const DEFAULT_HEIGHT = 80;
const STAGGER_DELAY = 60;

function AnimatedBar({
  value,
  maxValue,
  chartHeight,
  barWidth,
  color,
  index,
}: {
  value: number;
  maxValue: number;
  chartHeight: number;
  barWidth: number;
  color: string;
  index: number;
}) {
  const { radius } = useTheme();
  const heightAnim = useSharedValue(0);

  const targetHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;

  useEffect(() => {
    heightAnim.value = withDelay(
      index * STAGGER_DELAY,
      withTiming(targetHeight, {
        duration: 400,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [targetHeight, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: heightAnim.value,
  }));

  return (
    <View style={[styles.barContainer, { width: barWidth, height: chartHeight }]}>
      <Animated.View
        style={[
          styles.bar,
          {
            width: barWidth,
            backgroundColor: color,
            borderTopLeftRadius: radius.xs,
            borderTopRightRadius: radius.xs,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

export const MiniBarChart = React.memo(function MiniBarChart({
  data,
  labels,
  color,
  height = DEFAULT_HEIGHT,
  style,
}: MiniBarChartProps) {
  const { colors, typography: typo, spacing } = useTheme();
  const barColor = color ?? colors.primary;
  const maxValue = Math.max(...data, 0);

  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.chartRow}>
        {data.map((value, index) => {
          const barWidth = `${(100 - (data.length - 1) * 1.2) / data.length}%` as unknown as number;
          return (
            <View key={index} style={styles.column}>
              <View style={[styles.barArea, { height }]}>
                {maxValue === 0 ? (
                  <View
                    style={[
                      styles.placeholderLine,
                      { backgroundColor: colors.border },
                    ]}
                  />
                ) : (
                  <AnimatedBar
                    value={value}
                    maxValue={maxValue}
                    chartHeight={height}
                    barWidth={16}
                    color={barColor}
                    index={index}
                  />
                )}
              </View>
              {labels && labels[index] != null && (
                <Text
                  style={[
                    styles.label,
                    {
                      fontSize: typo.caption.fontSize,
                      fontWeight: typo.caption.fontWeight,
                      lineHeight: typo.caption.lineHeight,
                      color: colors.textLight,
                      marginTop: spacing.xs,
                    },
                  ]}
                >
                  {labels[index]}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  barArea: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barContainer: {
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    position: 'absolute',
    bottom: 0,
  },
  placeholderLine: {
    position: 'absolute',
    bottom: 0,
    width: '60%',
    height: 1,
  },
  label: {
    textAlign: 'center',
  },
});
