/**
 * GameTypeDonut - Horizontal stacked bar chart with legend.
 * Simplified alternative to a donut chart (no SVG dependency).
 * Uses View-based rendering with animated segments.
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

interface GameTypeDonutProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
  style?: ViewStyle;
}

const BAR_HEIGHT = 12;
const STAGGER_DELAY = 80;

function AnimatedSegment({
  percentage,
  color,
  index,
  isFirst,
  isLast,
  borderRadius,
}: {
  percentage: number;
  color: string;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  borderRadius: number;
}) {
  const widthAnim = useSharedValue(0);

  useEffect(() => {
    widthAnim.value = withDelay(
      index * STAGGER_DELAY,
      withTiming(percentage, {
        duration: 500,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [percentage, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${widthAnim.value}%` as unknown as number,
  }));

  return (
    <Animated.View
      style={[
        styles.segment,
        {
          backgroundColor: color,
          height: BAR_HEIGHT,
          borderTopLeftRadius: isFirst ? borderRadius : 0,
          borderBottomLeftRadius: isFirst ? borderRadius : 0,
          borderTopRightRadius: isLast ? borderRadius : 0,
          borderBottomRightRadius: isLast ? borderRadius : 0,
        },
        animatedStyle,
      ]}
    />
  );
}

export const GameTypeDonut = React.memo(function GameTypeDonut({
  data,
  size: _size,
  strokeWidth: _strokeWidth,
  style,
}: GameTypeDonutProps) {
  const { colors, typography: typo, spacing, radius } = useTheme();

  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Calculate percentages
  const segments = data.map((item) => ({
    ...item,
    percentage: total > 0 ? (item.value / total) * 100 : 0,
  }));

  return (
    <View style={[styles.wrapper, style]}>
      {/* Horizontal stacked bar */}
      <View
        style={[
          styles.barContainer,
          {
            height: BAR_HEIGHT,
            backgroundColor: colors.border,
            borderRadius: radius.full,
          },
        ]}
      >
        {segments.map((segment, index) => (
          <AnimatedSegment
            key={index}
            percentage={segment.percentage}
            color={segment.color}
            index={index}
            isFirst={index === 0}
            isLast={index === segments.length - 1}
            borderRadius={radius.full}
          />
        ))}
      </View>

      {/* Legend */}
      <View style={[styles.legend, { marginTop: spacing.md }]}>
        {segments.map((segment, index) => (
          <View key={index} style={[styles.legendItem, { marginRight: spacing.lg }]}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: segment.color,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginRight: spacing.xs,
                },
              ]}
            />
            <Text
              style={{
                fontSize: typo.caption.fontSize,
                fontWeight: typo.caption.fontWeight,
                lineHeight: typo.caption.lineHeight,
                color: colors.textSecondary,
              }}
            >
              {segment.label}
            </Text>
            <Text
              style={{
                fontSize: typo.caption.fontSize,
                fontWeight: '700',
                lineHeight: typo.caption.lineHeight,
                color: colors.text,
                marginLeft: spacing.xs,
              }}
            >
              {Math.round(segment.percentage)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  barContainer: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segment: {
    // width set by animation
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  legendDot: {
    // size set inline
  },
});
