import React from 'react';
import { Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Icon, type IconName } from './Icon';
import { useScalePress } from '../../utils/animations';

type ChipVariant = 'filled' | 'outline' | 'selected';
type ChipSize = 'sm' | 'md';

interface ChipProps {
  label: string;
  variant?: ChipVariant;
  color?: string;
  size?: ChipSize;
  icon?: IconName;
  onPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

const sizeConfig = {
  sm: {
    height: 26,
    paddingHorizontal: spacing.sm,
    textStyle: typography.caption,
    iconSize: 14,
  },
  md: {
    height: 32,
    paddingHorizontal: spacing.md,
    textStyle: typography.body2,
    iconSize: 16,
  },
} as const;

function ChipContent({
  label,
  variant = 'filled',
  color,
  size = 'md',
  icon,
  style,
}: Omit<ChipProps, 'onPress'>) {
  const { colors } = useTheme();
  const chipColor = color || colors.primary;
  const s = sizeConfig[size];

  const backgroundColor =
    variant === 'filled'
      ? alpha(chipColor, 0.12)
      : variant === 'selected'
        ? chipColor
        : 'transparent';

  const textColor = variant === 'selected' ? colors.textInverse : chipColor;
  const borderWidth = variant === 'outline' ? 1 : 0;
  const borderColor = variant === 'outline' ? chipColor : 'transparent';

  return (
    <View
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingHorizontal,
          backgroundColor,
          borderWidth,
          borderColor,
        },
        style,
      ]}
    >
      {icon && (
        <Icon name={icon} size={s.iconSize} color={textColor} />
      )}
      <Text style={[s.textStyle, { color: textColor }]}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  variant = 'filled',
  color,
  size = 'md',
  icon,
  onPress,
  style,
  accessibilityLabel,
}: ChipProps) {
  const { colors } = useTheme();
  const chipColor = color || colors.primary;
  const { animatedStyle, onPressIn, onPressOut } = useScalePress();

  if (onPress) {
    return (
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel || label}
        >
          <ChipContent
            label={label}
            variant={variant}
            color={chipColor}
            size={size}
            icon={icon}
            style={style}
          />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <ChipContent
      label={label}
      variant={variant}
      color={chipColor}
      size={size}
      icon={icon}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    gap: spacing.xs,
  },
});
