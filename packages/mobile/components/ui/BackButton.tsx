import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { Icon } from './Icon';
import { useTheme } from '../../hooks/useTheme';
import { useScalePress } from '../../utils/animations';
import { spacing, radius } from '../../constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface BackButtonProps {
  onPress?: () => void;
}

export function BackButton({ onPress }: BackButtonProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { animatedStyle, onPressIn, onPressOut } = useScalePress();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.back();
    }
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.button, { backgroundColor: colors.surface }, animatedStyle]}
      accessibilityLabel="뒤로가기"
      accessibilityRole="button"
    >
      <Icon name="chevronLeft" size={24} color={colors.text} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
});
