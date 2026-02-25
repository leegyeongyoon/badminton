import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { StatusDot } from '../ui/StatusDot';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { Strings } from '../../constants/strings';
import { useScalePress, useFadeIn } from '../../utils/animations';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface RestToggleCardProps {
  isResting: boolean;
  restLoading: boolean;
  onToggle: () => void;
  restDurationMinutes?: number;
}

export function RestToggleCard({ isResting, restLoading, onToggle, restDurationMinutes }: RestToggleCardProps) {
  const { colors, shadows } = useTheme();
  const fadeInStyle = useFadeIn();
  const { animatedStyle: scaleStyle, onPressIn, onPressOut } = useScalePress();

  // Animated toggle progress: 0 = available, 1 = resting
  const toggleProgress = useSharedValue(isResting ? 1 : 0);

  useEffect(() => {
    toggleProgress.value = withTiming(isResting ? 1 : 0, { duration: 300 });
  }, [isResting]);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const bgColor = interpolateColor(
      toggleProgress.value,
      [0, 1],
      [palette.white, alpha(colors.playerResting, 0.05)],
    );
    return { backgroundColor: bgColor };
  });

  const buttonAnimatedStyle = useAnimatedStyle(() => {
    const bgColor = interpolateColor(
      toggleProgress.value,
      [0, 1],
      [colors.playerResting, colors.secondary],
    );
    return { backgroundColor: bgColor };
  });

  return (
    <Animated.View style={[styles.container, shadows.md, fadeInStyle, cardAnimatedStyle]}>
      <View style={styles.row}>
        <StatusDot color={isResting ? colors.playerResting : colors.playerAvailable} size="lg" />
        <View style={styles.textWrap}>
          <Text style={[styles.label, { color: colors.textLight }]}>현재 상태</Text>
          <Text style={[styles.value, { color: isResting ? colors.playerResting : colors.playerAvailable }]}>
            {isResting
              ? (restDurationMinutes && restDurationMinutes > 0
                ? `휴식 중 \u2022 ${restDurationMinutes}분 경과`
                : Strings.player.status.RESTING)
              : Strings.player.status.AVAILABLE}
          </Text>
        </View>
      </View>
      <AnimatedPressable
        style={[styles.button, scaleStyle, buttonAnimatedStyle]}
        onPress={onToggle}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={restLoading}
        accessibilityLabel={isResting ? '가용 상태로 전환' : '휴식 모드로 전환'}
        accessibilityRole="button"
      >
        {restLoading ? (
          <ActivityIndicator size="small" color={palette.white} />
        ) : (
          <>
            <Icon name={isResting ? 'available' : 'resting'} size={16} color={palette.white} />
            <Text style={styles.buttonText}>
              {isResting ? Strings.player.toggleAvailable : Strings.player.toggleRest}
            </Text>
          </>
        )}
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.card,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.mlg, marginBottom: spacing.lg },
  textWrap: { flex: 1 },
  label: { ...typography.caption, marginBottom: 2 },
  value: { fontSize: 17, fontWeight: '700' },
  button: {
    paddingVertical: spacing.mlg, paddingHorizontal: spacing.xl, borderRadius: radius.xxl,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
  },
  buttonText: { color: palette.white, ...typography.button },
});
