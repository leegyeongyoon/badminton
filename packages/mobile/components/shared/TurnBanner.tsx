import { useEffect, useRef, useCallback } from 'react';
import { Text, StyleSheet, Pressable, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { palette, radius, spacing, typography } from '../../constants/theme';
import { springPresets } from '../../utils/animations';
import { haptics } from '../../utils/haptics';
import { useBannerStore } from '../../store/bannerStore';

const AUTO_HIDE_MS = 6000;

/**
 * Top-anchored, full-width animated "내 차례" banner.
 * Reads from bannerStore; springs in on show, auto-hides after ~6s, and
 * routes to /(tabs)/my-status on tap. Triggers haptics on show.
 * Render once near the root overlay container so it floats over all screens.
 */
export function TurnBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useTheme();
  const { visible, title, subtitle, hide } = useBannerStore();

  const translateY = useSharedValue(-160);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    opacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.cubic) });
    translateY.value = withTiming(-160, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(hide)();
    });
  }, [hide, opacity, translateY]);

  useEffect(() => {
    if (visible) {
      haptics.success();
      opacity.value = withTiming(1, { duration: 180 });
      translateY.value = withSpring(0, springPresets.gentle);
      timerRef.current = setTimeout(() => dismiss(), AUTO_HIDE_MS);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, title, subtitle]);

  const handlePress = useCallback(() => {
    dismiss();
    router.push('/(tabs)/my-status');
  }, [dismiss, router]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { top: insets.top + spacing.sm }, animatedStyle]}
    >
      <Pressable
        onPress={handlePress}
        style={[styles.banner, { backgroundColor: colors.primary }, shadows.lg]}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 10000,
  },
  banner: {
    borderRadius: radius.banner,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.subtitle1,
    color: palette.white,
  },
  subtitle: {
    ...typography.body2,
    color: palette.white,
    opacity: 0.9,
    marginTop: spacing.xs,
  },
});
