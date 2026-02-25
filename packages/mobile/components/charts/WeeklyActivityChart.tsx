/**
 * WeeklyActivityChart - Larger weekly bar chart with touch interaction.
 * Shows grid lines and tooltips on press. View-based rendering only.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { alpha } from '../../utils/color';

interface WeeklyActivityChartProps {
  data: { day: string; count: number }[];
  style?: ViewStyle;
}

const CHART_HEIGHT = 160;
const STAGGER_DELAY = 70;
const GRID_LINE_COUNT = 3; // 25%, 50%, 75%

function AnimatedBar({
  value,
  maxValue,
  index,
  color,
  isSelected,
  onPress,
}: {
  value: number;
  maxValue: number;
  index: number;
  color: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  const { radius, colors } = useTheme();
  const heightAnim = useSharedValue(0);

  const targetHeight = maxValue > 0 ? (value / maxValue) * CHART_HEIGHT : 0;

  useEffect(() => {
    heightAnim.value = withDelay(
      index * STAGGER_DELAY,
      withTiming(targetHeight, {
        duration: 500,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [targetHeight, index]);

  const barStyle = useAnimatedStyle(() => ({
    height: heightAnim.value,
  }));

  return (
    <Pressable onPress={onPress} style={styles.barPressable}>
      <View style={styles.barWrapper}>
        {/* Tooltip */}
        {isSelected && value > 0 && (
          <View
            style={[
              styles.tooltip,
              {
                backgroundColor: colors.text,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Text style={[styles.tooltipText, { color: colors.textInverse }]}>
              {value}
            </Text>
          </View>
        )}
        <View style={[styles.barAreaInner, { height: CHART_HEIGHT }]}>
          <Animated.View
            style={[
              styles.bar,
              {
                backgroundColor: isSelected ? color : alpha(color, 0.7),
                borderTopLeftRadius: radius.xs,
                borderTopRightRadius: radius.xs,
              },
              barStyle,
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

export const WeeklyActivityChart = React.memo(function WeeklyActivityChart({ data, style }: WeeklyActivityChartProps) {
  const { colors, typography: typo, spacing } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const maxValue = Math.max(...data.map((d) => d.count), 1);

  const handleBarPress = useCallback(
    (index: number) => {
      setSelectedIndex((prev) => (prev === index ? null : index));
    },
    [],
  );

  return (
    <View style={[styles.wrapper, style]}>
      {/* Chart area with grid lines */}
      <View style={styles.chartArea}>
        {/* Grid lines */}
        {Array.from({ length: GRID_LINE_COUNT }).map((_, i) => {
          const position = ((i + 1) / (GRID_LINE_COUNT + 1)) * CHART_HEIGHT;
          return (
            <View
              key={i}
              style={[
                styles.gridLine,
                {
                  bottom: position,
                  borderBottomColor: colors.border,
                },
              ]}
            />
          );
        })}

        {/* Bars */}
        <View style={styles.barsRow}>
          {data.map((item, index) => (
            <AnimatedBar
              key={index}
              value={item.count}
              maxValue={maxValue}
              index={index}
              color={colors.primary}
              isSelected={selectedIndex === index}
              onPress={() => handleBarPress(index)}
            />
          ))}
        </View>
      </View>

      {/* Labels */}
      <View style={styles.labelsRow}>
        {data.map((item, index) => (
          <View key={index} style={styles.labelContainer}>
            <Text
              style={[
                styles.label,
                {
                  fontSize: typo.caption.fontSize,
                  fontWeight: typo.caption.fontWeight,
                  lineHeight: typo.caption.lineHeight,
                  color:
                    selectedIndex === index
                      ? colors.primary
                      : colors.textLight,
                  marginTop: spacing.xs,
                },
              ]}
            >
              {item.day}
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
  chartArea: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  barsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barPressable: {
    flex: 1,
    alignItems: 'center',
  },
  barWrapper: {
    alignItems: 'center',
  },
  barAreaInner: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: 24,
  },
  bar: {
    width: 20,
    position: 'absolute',
    bottom: 0,
    left: 2,
    right: 2,
  },
  tooltip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  tooltipText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelContainer: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
