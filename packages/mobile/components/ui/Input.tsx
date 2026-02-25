import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  ViewStyle,
  TextInputProps,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius, opacity } from '../../constants/theme';
import { Icon, type IconName } from './Icon';
import { timingPresets } from '../../utils/animations';

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  icon?: IconName;
  disabled?: boolean;
  maxLength?: number;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  keyboardType?: TextInputProps['keyboardType'];
  secureTextEntry?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
  onBlur?: () => void;
}

export function Input({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  icon,
  disabled = false,
  maxLength,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  style,
  accessibilityLabel,
  onBlur: onBlurProp,
}: InputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const focus = useSharedValue(0);
  const shakeOffset = useSharedValue(0);
  const prevError = useRef<string | undefined>(undefined);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    focus.value = withTiming(1, timingPresets.fast);
  }, [focus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    focus.value = withTiming(0, timingPresets.fast);
    onBlurProp?.();
  }, [focus, onBlurProp]);

  // Shake when error appears
  useEffect(() => {
    if (error && error !== prevError.current) {
      shakeOffset.value = withSequence(
        withTiming(10, { duration: 50 }),
        withTiming(-10, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(-6, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    }
    prevError.current = error;
  }, [error, shakeOffset]);

  const borderAnimatedStyle = useAnimatedStyle(() => {
    const borderColor = error
      ? colors.danger
      : interpolateColor(
          focus.value,
          [0, 1],
          [colors.border, colors.primary],
        );
    return { borderBottomColor: borderColor };
  });

  const shakeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }],
  }));

  const labelColor = error
    ? colors.danger
    : isFocused
      ? colors.primary
      : colors.textSecondary;

  return (
    <Animated.View style={[styles.wrapper, style, shakeAnimatedStyle]}>
      {label && (
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      )}
      <Animated.View
        style={[
          styles.container,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
          borderAnimatedStyle,
          disabled && styles.disabled,
        ]}
      >
        {icon && (
          <View style={styles.iconContainer}>
            <Icon
              name={icon}
              size={18}
              color={isFocused ? colors.primary : colors.textSecondary}
            />
          </View>
        )}
        <TextInput
          style={[styles.input, { color: colors.text }, icon && styles.inputWithIcon]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textLight}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={!disabled}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          accessibilityLabel={accessibilityLabel || label || placeholder}
        />
        {error && (
          <View style={styles.errorIconContainer}>
            <Icon name="error" size={16} color={colors.danger} />
          </View>
        )}
      </Animated.View>
      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    ...typography.caption,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
  },
  iconContainer: {
    marginRight: spacing.sm,
  },
  errorIconContainer: {
    marginLeft: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body1,
    padding: 0,
  },
  inputWithIcon: {
    // No extra padding needed; iconContainer handles spacing
  },
  error: {
    ...typography.caption,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
