import React, { useEffect } from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { spacing, radius, typography } from '../../constants/theme';
import { timingPresets } from '../../utils/animations';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  visible: boolean;
  message: string;
  position?: TooltipPosition;
  onDismiss: () => void;
}

const ARROW_SIZE = 8;
const BG_COLOR = 'rgba(15, 23, 42, 0.92)'; // slate900 with slight transparency

/**
 * Position-based animated tooltip.
 * Shows a dark tooltip with an arrow pointer on the specified side.
 * Fades in with a slight slide and auto-dismisses on tap.
 */
export function Tooltip({ visible, message, position = 'bottom', onDismiss }: TooltipProps) {
  const opacity = useSharedValue(0);
  const translateOffset = useSharedValue(getInitialOffset(position));

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, timingPresets.normal);
      translateOffset.value = withTiming(0, timingPresets.normal);
    } else {
      opacity.value = withTiming(0, timingPresets.fast);
      translateOffset.value = withTiming(getInitialOffset(position), timingPresets.fast);
    }
  }, [visible, position]);

  const isHorizontal = position === 'left' || position === 'right';

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: isHorizontal
      ? [{ translateX: translateOffset.value }]
      : [{ translateY: translateOffset.value }],
  }));

  if (!visible) return null;

  const positionStyle = getPositionStyle(position);
  const arrowStyle = getArrowStyle(position);

  return (
    <Animated.View style={[styles.container, positionStyle, animatedStyle, { pointerEvents: 'box-none' as const }]}>
      <Pressable onPress={onDismiss} style={styles.pressable}>
        <Animated.View style={[styles.bubble, { backgroundColor: BG_COLOR }]}>
          <Text style={styles.text}>{message}</Text>
        </Animated.View>
        <Animated.View style={[styles.arrow, arrowStyle, { borderColor: 'transparent' }]}>
          {/* Arrow is created via border trick */}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function getInitialOffset(position: TooltipPosition): number {
  switch (position) {
    case 'top': return -8;
    case 'bottom': return 8;
    case 'left': return -8;
    case 'right': return 8;
  }
}

function getPositionStyle(position: TooltipPosition): ViewStyle {
  switch (position) {
    case 'top':
      return { bottom: '100%', marginBottom: ARROW_SIZE + 4, alignSelf: 'center' };
    case 'bottom':
      return { top: '100%', marginTop: ARROW_SIZE + 4, alignSelf: 'center' };
    case 'left':
      return { right: '100%', marginRight: ARROW_SIZE + 4, alignSelf: 'center' };
    case 'right':
      return { left: '100%', marginLeft: ARROW_SIZE + 4, alignSelf: 'center' };
  }
}

function getArrowStyle(position: TooltipPosition): ViewStyle {
  const base: ViewStyle = {
    width: 0,
    height: 0,
    borderWidth: ARROW_SIZE,
    position: 'absolute',
  };

  switch (position) {
    case 'top':
      return {
        ...base,
        bottom: -ARROW_SIZE * 2,
        alignSelf: 'center',
        borderTopColor: BG_COLOR,
        borderBottomWidth: 0,
      };
    case 'bottom':
      return {
        ...base,
        top: -ARROW_SIZE * 2,
        alignSelf: 'center',
        borderBottomColor: BG_COLOR,
        borderTopWidth: 0,
      };
    case 'left':
      return {
        ...base,
        right: -ARROW_SIZE * 2,
        top: '50%',
        marginTop: -ARROW_SIZE,
        borderLeftColor: BG_COLOR,
        borderRightWidth: 0,
      };
    case 'right':
      return {
        ...base,
        left: -ARROW_SIZE * 2,
        top: '50%',
        marginTop: -ARROW_SIZE,
        borderRightColor: BG_COLOR,
        borderLeftWidth: 0,
      };
  }
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 1000,
  },
  pressable: {
    alignItems: 'center',
  },
  bubble: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    maxWidth: 240,
  },
  text: {
    color: '#FFFFFF',
    ...typography.caption,
    textAlign: 'center',
  },
  arrow: {
    // Styled dynamically via getArrowStyle
  },
});
