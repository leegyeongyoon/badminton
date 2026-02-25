/**
 * PeakHoursChart - Heatmap grid for peak usage hours.
 * View-based rendering with color intensity based on values.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { alpha } from '../../utils/color';

interface PeakHoursChartProps {
  data: number[][];
  hours: string[];
  days: string[];
  style?: ViewStyle;
}

const CELL_GAP = 2;
const LABEL_WIDTH = 24;
const LABEL_BOTTOM_HEIGHT = 18;

function HeatmapCell({
  value,
  maxValue,
  primaryColor,
  size,
  rowIndex,
  colIndex,
}: {
  value: number;
  maxValue: number;
  primaryColor: string;
  size: number;
  rowIndex: number;
  colIndex: number;
}) {
  const { radius } = useTheme();
  const opacityAnim = useSharedValue(0);

  const intensity = maxValue > 0 ? value / maxValue : 0;
  const cellOpacity = 0.05 + intensity * 0.75; // 0.05 to 0.8

  React.useEffect(() => {
    opacityAnim.value = withDelay(
      (rowIndex * 3 + colIndex) * 15,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }),
    );
  }, [rowIndex, colIndex]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacityAnim.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.xs / 2,
          backgroundColor: alpha(primaryColor, cellOpacity),
          marginRight: CELL_GAP,
          marginBottom: CELL_GAP,
        },
        animatedStyle,
      ]}
    />
  );
}

export const PeakHoursChart = React.memo(function PeakHoursChart({
  data,
  hours,
  days,
  style,
}: PeakHoursChartProps) {
  const { colors, typography: typo, spacing } = useTheme();
  const [containerWidth, setContainerWidth] = React.useState(0);

  const numCols = hours.length;
  const maxValue = Math.max(...data.flat(), 0);

  // Calculate cell size based on available width
  const availableWidth = containerWidth - LABEL_WIDTH - spacing.xs;
  const cellSize =
    numCols > 0
      ? Math.max(8, Math.floor((availableWidth - (numCols - 1) * CELL_GAP) / numCols))
      : 12;

  return (
    <View
      style={[styles.wrapper, style]}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <>
          {/* Rows */}
          {data.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              {/* Day label */}
              <View style={[styles.dayLabel, { width: LABEL_WIDTH }]}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: typo.caption.fontWeight,
                    color: colors.textLight,
                  }}
                >
                  {days[rowIndex] ?? ''}
                </Text>
              </View>
              {/* Cells */}
              <View style={styles.cellRow}>
                {row.map((value, colIndex) => (
                  <HeatmapCell
                    key={colIndex}
                    value={value}
                    maxValue={maxValue}
                    primaryColor={colors.primary}
                    size={cellSize}
                    rowIndex={rowIndex}
                    colIndex={colIndex}
                  />
                ))}
              </View>
            </View>
          ))}

          {/* Hour labels */}
          <View style={[styles.hourLabelsRow, { marginLeft: LABEL_WIDTH }]}>
            {hours.map((hour, i) => (
              <Text
                key={i}
                style={[
                  styles.hourLabel,
                  {
                    width: cellSize + CELL_GAP,
                    fontSize: 9,
                    color: colors.textLight,
                  },
                ]}
              >
                {i % 2 === 0 ? hour : ''}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayLabel: {
    justifyContent: 'center',
  },
  cellRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
  hourLabelsRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  hourLabel: {
    textAlign: 'center',
    fontWeight: '500',
  },
});
