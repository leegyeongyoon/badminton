/**
 * AnimatedPressable - drop-in replacement for TouchableOpacity
 * with Reanimated press animation and haptic feedback.
 */
import React, { useCallback } from 'react';
import { Pressable, PressableProps, ViewStyle, GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useScalePress } from '../../utils/animations';
import { haptics } from '../../utils/haptics';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export interface AnimatedPressableProps extends PressableProps {
  hapticType?: 'light' | 'medium' | 'selection' | 'none';
  scaleValue?: number;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}

export function AnimatedPressable({
  hapticType = 'light',
  scaleValue = 0.97,
  children,
  style,
  onPress,
  onPressIn: onPressInProp,
  onPressOut: onPressOutProp,
  ...rest
}: AnimatedPressableProps) {
  const { animatedStyle, onPressIn, onPressOut } = useScalePress(scaleValue);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      onPressIn();
      onPressInProp?.(e);
    },
    [onPressIn, onPressInProp],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      onPressOut();
      onPressOutProp?.(e);
    },
    [onPressOut, onPressOutProp],
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (hapticType !== 'none') {
        haptics[hapticType]();
      }
      onPress?.(e);
    },
    [hapticType, onPress],
  );

  return (
    <AnimatedPressableBase
      accessibilityRole="button"
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}
