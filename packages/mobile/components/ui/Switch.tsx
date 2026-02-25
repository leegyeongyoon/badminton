import React, { useCallback } from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { opacity, radius } from '../../constants/theme';
import { palette } from '../../constants/theme';
import { springPresets } from '../../utils/animations';
import { haptics } from '../../utils/haptics';

interface SwitchProps {
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
  trackActiveColor?: string;
  trackInactiveColor?: string;
}

const TRACK_WIDTH = 48;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const THUMB_OFFSET_OFF = 3;
const THUMB_OFFSET_ON = TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET_OFF;

export function Switch({
  value,
  onValueChange,
  disabled = false,
  trackActiveColor,
  trackInactiveColor,
}: SwitchProps) {
  const { colors, shadows } = useTheme();
  const activeColor = trackActiveColor || colors.primary;
  const inactiveColor = trackInactiveColor || palette.slate300;

  const progress = useSharedValue(value ? 1 : 0);

  // Sync animation when value prop changes
  React.useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, springPresets.gentle);
  }, [value, progress]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    haptics.light();
    onValueChange(!value);
  }, [disabled, value, onValueChange]);

  const trackAnimatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      [inactiveColor, activeColor],
    );
    return { backgroundColor };
  });

  const thumbAnimatedStyle = useAnimatedStyle(() => {
    const translateX =
      THUMB_OFFSET_OFF +
      progress.value * (THUMB_OFFSET_ON - THUMB_OFFSET_OFF);
    return {
      transform: [{ translateX }],
    };
  });

  return (
    <View style={styles.touchTarget}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={[disabled && styles.disabled]}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      >
        <Animated.View style={[styles.track, trackAnimatedStyle]}>
          <Animated.View style={[styles.thumb, shadows.sm, thumbAnimatedStyle]} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: palette.white,
    position: 'absolute',
  },
  touchTarget: {
    minHeight: 44,
    minWidth: 48,
    justifyContent: 'center',
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
