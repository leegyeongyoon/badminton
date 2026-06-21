import { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
import { Icon } from '../ui/Icon';

// Persist long enough to be noticed and acted on (the old 6s was too aggressive).
const AUTO_HIDE_MS = 12000;

/**
 * Top-anchored, full-width animated "내 차례" banner.
 * Reads from bannerStore; springs in on show, auto-hides after ~12s (or via the
 * manual × close), and on tap routes DIRECTLY to the live board
 * (/session/<clubSessionId>/board) so the player sees their court immediately.
 * Falls back to /(tabs)/my-status when no session id is known. Triggers haptics
 * on show. Render once near the root overlay container so it floats over all
 * screens.
 */
export function TurnBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useTheme();
  const { visible, title, subtitle, clubSessionId, hide } = useBannerStore();

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
    if (clubSessionId) {
      router.push(`/session/${clubSessionId}/board`);
    } else {
      router.push('/(tabs)/my-status');
    }
  }, [dismiss, router, clubSessionId]);

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
        <View style={styles.iconWrap}>
          <Icon name="play" size={20} color={palette.white} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={12}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        >
          <Icon name="close" size={18} color={palette.white} />
        </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.banner,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, minWidth: 0 },
  title: {
    ...typography.subtitle1,
    color: palette.white,
  },
  subtitle: {
    ...typography.body2,
    color: palette.white,
    opacity: 0.92,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
