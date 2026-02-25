/**
 * Reanimated animation utilities.
 * Provides reusable hooks for common animation patterns.
 */
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';
import { useEffect } from 'react';

// ─── Spring/Timing Presets ────────────────────────────────────
export const springPresets = {
  gentle: { damping: 20, stiffness: 150, mass: 1 },
  bouncy: { damping: 12, stiffness: 200, mass: 0.8 },
  stiff: { damping: 30, stiffness: 300, mass: 1 },
  press: { damping: 15, stiffness: 200, mass: 0.6 },
} as const;

export const timingPresets = {
  fast: { duration: 150, easing: Easing.out(Easing.cubic) },
  normal: { duration: 250, easing: Easing.out(Easing.cubic) },
  slow: { duration: 400, easing: Easing.out(Easing.cubic) },
} as const;

// ─── useScalePress ────────────────────────────────────────────
/** Returns animated style for press scale effect. */
export function useScalePress(scale = 0.97) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scale]) }],
  }));

  const onPressIn = () => {
    pressed.value = withSpring(1, springPresets.press);
  };

  const onPressOut = () => {
    pressed.value = withSpring(0, springPresets.press);
  };

  return { animatedStyle, onPressIn, onPressOut };
}

// ─── useFadeIn ────────────────────────────────────────────────
/** Fade + slide-up on mount. */
export function useFadeIn(delay = 0) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, timingPresets.normal));
    translateY.value = withDelay(delay, withTiming(0, timingPresets.normal));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return animatedStyle;
}

// ─── useStagger ───────────────────────────────────────────────
/** Stagger fade-in based on list index. */
export function useStagger(index: number, baseDelay = 50) {
  return useFadeIn(index * baseDelay);
}

// ─── usePulse ─────────────────────────────────────────────────
/** Repeating pulse opacity animation. */
export function usePulse(minOpacity = 0.4, maxOpacity = 1, duration = 1200) {
  const opacity = useSharedValue(maxOpacity);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(minOpacity, { duration }),
        withTiming(maxOpacity, { duration }),
      ),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return animatedStyle;
}

// ─── useGlowBorder ───────────────────────────────────────────
/** Pulsing border opacity for "my turn" glow effect. */
export function useGlowBorder() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  return progress;
}

// ─── useAnimatedNumber ────────────────────────────────────────
/** Smoothly animates a displayed number. */
export function useAnimatedNumber(value: number) {
  const animatedValue = useSharedValue(value);

  useEffect(() => {
    animatedValue.value = withTiming(value, timingPresets.normal);
  }, [value]);

  return animatedValue;
}

// ─── useSlideIn ──────────────────────────────────────────────
/** Fade + slide on mount with configurable direction. */
export function useSlideIn(
  direction: 'left' | 'right' | 'up' | 'down' = 'up',
  delay = 0,
) {
  const opacity = useSharedValue(0);
  const translate = useSharedValue(
    direction === 'left' ? -20 : direction === 'right' ? 20 : direction === 'up' ? 12 : -12,
  );

  const isHorizontal = direction === 'left' || direction === 'right';

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, timingPresets.normal));
    translate.value = withDelay(delay, withTiming(0, timingPresets.normal));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: isHorizontal
      ? [{ translateX: translate.value }]
      : [{ translateY: translate.value }],
  }));

  return animatedStyle;
}

// ─── useShake ────────────────────────────────────────────────
/** Horizontal shake for error states. */
export function useShake() {
  const offset = useSharedValue(0);

  const shake = () => {
    offset.value = withSequence(
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return { shake, animatedStyle };
}

// ─── useBounce ───────────────────────────────────────────────
/** Attention-grabbing bounce animation. */
export function useBounce() {
  const scale = useSharedValue(1);

  const bounce = () => {
    scale.value = withSequence(
      withSpring(1.1, springPresets.bouncy),
      withSpring(0.95, springPresets.bouncy),
      withSpring(1, springPresets.gentle),
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { bounce, animatedStyle };
}

// ─── useCountUp ──────────────────────────────────────────────
/** Animates a number from 0 to target. Returns a SharedValue. */
export function useCountUp(target: number, duration = 600) {
  const value = useSharedValue(0);

  useEffect(() => {
    value.value = withTiming(target, { duration, easing: Easing.out(Easing.cubic) });
  }, [target]);

  return value;
}
