import React, { useCallback } from 'react';
import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius, opacity } from '../../constants/theme';
import { Icon, IconName } from './Icon';
import { haptics } from '../../utils/haptics';
import { useScalePress } from '../../utils/animations';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const sizeStyles: Record<ButtonSize, { paddingV: number; paddingH: number; fontSize: number; iconSize: number }> = {
  sm: { paddingV: spacing.sm, paddingH: spacing.mlg, fontSize: 13, iconSize: 16 },
  md: { paddingV: spacing.mlg, paddingH: spacing.xl, fontSize: 15, iconSize: 18 },
  lg: { paddingV: 18, paddingH: spacing.xxl, fontSize: 17, iconSize: 20 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const { colors, shadows } = useTheme();

  const variantStyles: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
    primary: { bg: colors.primary, text: colors.textInverse },
    secondary: { bg: colors.secondary, text: colors.textInverse },
    danger: { bg: colors.danger, text: colors.textInverse },
    outline: { bg: 'transparent', text: colors.primary, border: colors.primary },
    ghost: { bg: 'transparent', text: colors.primary },
  };

  const v = variantStyles[variant];
  const s = sizeStyles[size];
  const isDisabled = disabled || loading;

  const { animatedStyle, onPressIn, onPressOut } = useScalePress(0.97);

  const handlePress = useCallback(() => {
    haptics.light();
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={accessibilityLabel || title}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          borderWidth: v.border ? 1.5 : 0,
          borderColor: v.border || 'transparent',
          opacity: isDisabled ? opacity.disabled : 1,
        },
        fullWidth && styles.fullWidth,
        variant !== 'ghost' && variant !== 'outline' && shadows.colored(v.bg),
        style,
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <>
          {icon && <Icon name={icon} size={s.iconSize} color={v.text} />}
          <Text style={[styles.text, { color: v.text, fontSize: s.fontSize }]}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.xxl,
    minHeight: 44,
  },
  fullWidth: {
    width: '100%',
  },
  text: {
    fontWeight: typography.button.fontWeight,
  },
});
