import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { timerLabel } from '../../utils/accessibility';

interface CountdownTimerProps {
  timeLimitAt: string;
  mode?: 'badge' | 'bar' | 'large';
}

// 0 = safe (green), 1 = warning (amber), 2 = danger (red)
type TimerZone = 0 | 1 | 2;

function getZone(minutes: number, expired: boolean): TimerZone {
  if (expired || minutes < 2) return 2;
  if (minutes < 5) return 1;
  return 0;
}

function useCountdown(timeLimitAt: string) {
  const { colors } = useTheme();
  const [remaining, setRemaining] = useState('');
  const [color, setColor] = useState(colors.timerSafe);
  const [progress, setProgress] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const totalMs = 30 * 60 * 1000;
    const update = () => {
      const diff = new Date(timeLimitAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(Strings.timer.expired);
        setColor(colors.timerDanger);
        setProgress(0);
        setSecondsLeft(0);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      const totalSeconds = Math.floor(diff / 1000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      setProgress(Math.min(diff / totalMs, 1));
      setSecondsLeft(totalSeconds);
      if (minutes < 2) setColor(colors.timerDanger);
      else if (minutes < 5) setColor(colors.timerWarning);
      else setColor(colors.timerSafe);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timeLimitAt, colors]);

  return { remaining, color, progress, secondsLeft };
}

export function CountdownTimer({ timeLimitAt, mode = 'large' }: CountdownTimerProps) {
  const { colors } = useTheme();
  const { remaining, color, progress, secondsLeft } = useCountdown(timeLimitAt);

  // Animated color zone: 0=safe, 1=warning, 2=danger
  const colorZone = useSharedValue(0);
  const prevZoneRef = useRef<TimerZone>(0);

  // Shake animation for critical threshold
  const shakeX = useSharedValue(0);
  const prevSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    if (secondsLeft === null) return;
    const minutes = Math.floor(secondsLeft / 60);
    const expired = secondsLeft <= 0;
    const zone = getZone(minutes, expired);

    if (zone !== prevZoneRef.current) {
      prevZoneRef.current = zone;
      colorZone.value = withTiming(zone, { duration: 400, easing: Easing.out(Easing.cubic) });
    }

    // Shake when crossing into critical threshold (30 seconds)
    const prevSeconds = prevSecondsRef.current;
    if (
      prevSeconds !== null &&
      prevSeconds > 30 &&
      secondsLeft <= 30 &&
      secondsLeft > 0
    ) {
      shakeX.value = withSequence(
        withTiming(-3, { duration: 40 }),
        withTiming(3, { duration: 40 }),
        withTiming(-3, { duration: 40 }),
        withTiming(3, { duration: 40 }),
        withTiming(-2, { duration: 40 }),
        withTiming(2, { duration: 40 }),
        withTiming(0, { duration: 40 }),
      );
    }
    prevSecondsRef.current = secondsLeft;
  }, [secondsLeft, colorZone, shakeX]);

  const animatedTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      colorZone.value,
      [0, 1, 2],
      [colors.timerSafe, colors.timerWarning, colors.timerDanger],
    ),
  }));

  const animatedBorderStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      colorZone.value,
      [0, 1, 2],
      [
        alpha(colors.timerSafe, 0.19),
        alpha(colors.timerWarning, 0.19),
        alpha(colors.timerDanger, 0.19),
      ],
    );
    return { borderColor };
  });

  const animatedBarStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      colorZone.value,
      [0, 1, 2],
      [colors.timerSafe, colors.timerWarning, colors.timerDanger],
    ),
  }));

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const minutes = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const seconds = secondsLeft !== null ? secondsLeft % 60 : 0;
  const a11yLabel = timerLabel(minutes, seconds);

  if (mode === 'badge') {
    return (
      <Animated.Text
        style={[styles.badgeText, animatedTextStyle, shakeStyle]}
        accessibilityLabel={a11yLabel}
        accessibilityLiveRegion="polite"
      >
        {remaining}
      </Animated.Text>
    );
  }

  if (mode === 'bar') {
    return (
      <Animated.View style={[styles.barContainer, shakeStyle]} accessibilityLabel={a11yLabel} accessibilityLiveRegion="polite">
        <View style={[styles.barBg, { backgroundColor: colors.divider }]}>
          <Animated.View
            style={[
              styles.barFill,
              { width: `${progress * 100}%` },
              animatedBarStyle,
            ]}
          />
        </View>
      </Animated.View>
    );
  }

  // large mode
  return (
    <Animated.View style={[styles.largeContainer, { backgroundColor: colors.surface }, animatedBorderStyle, shakeStyle]} accessibilityLabel={a11yLabel} accessibilityLiveRegion="polite">
      <Animated.Text style={[styles.largeLabel, animatedTextStyle]}>
        {Strings.timer.remaining}
      </Animated.Text>
      <Animated.Text style={[styles.largeValue, animatedTextStyle]}>
        {remaining}
      </Animated.Text>
      <View style={[styles.largeBarBg, { backgroundColor: colors.divider }]}>
        <Animated.View
          style={[
            styles.barFill,
            { width: `${progress * 100}%` },
            animatedBarStyle,
          ]}
        />
      </View>
    </Animated.View>
  );
}

// Also export the hook for custom usage
export { useCountdown };

const styles = StyleSheet.create({
  // Badge mode
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
    ...typography.tabular,
  },
  // Bar mode
  barContainer: {
    marginTop: spacing.sm,
  },
  barBg: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    borderRadius: 2,
  },
  // Large mode
  largeContainer: {
    borderRadius: radius.xl,
    borderWidth: 2,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  largeLabel: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  largeValue: {
    fontSize: 36,
    fontWeight: '800',
    ...typography.tabular,
    marginBottom: spacing.smd,
  },
  largeBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
});
