import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { palette, shadows, radius, spacing, typography } from '../../constants/theme';
import { toastEmitter, type ToastPayload, type ToastAction } from '../../utils/feedback';
import { Icon, IconName } from '../ui/Icon';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration: number;
  icon?: IconName;
}

const TOAST_ICON_MAP: Record<ToastType, IconName> = {
  success: 'success',
  error: 'error',
  info: 'info',
  warning: 'warning',
};

const DEFAULT_DURATION = 2500;
const MAX_TOASTS = 3;

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-30);
  const progress = useSharedValue(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Slide in
    opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });

    // Progress bar shrinks over duration
    progress.value = withTiming(0, {
      duration: toast.duration,
      easing: Easing.linear,
    });

    // Dismiss after duration
    timerRef.current = setTimeout(() => {
      dismiss();
    }, toast.duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = useCallback(() => {
    opacity.value = withTiming(0, { duration: 250, easing: Easing.in(Easing.cubic) });
    translateY.value = withTiming(-30, { duration: 250, easing: Easing.in(Easing.cubic) });
    // Wait for animation to complete then call onDone
    setTimeout(() => {
      onDone();
    }, 260);
  }, [onDone, opacity, translateY]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const progressAnimatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as any,
  }));

  const bgColor =
    toast.type === 'success'
      ? colors.secondary
      : toast.type === 'error'
        ? colors.danger
        : toast.type === 'warning'
          ? colors.warning
          : colors.primary;

  const iconName = toast.icon || TOAST_ICON_MAP[toast.type];

  return (
    <Animated.View
      style={[styles.toast, { backgroundColor: bgColor }, containerAnimatedStyle]}
    >
      <View style={styles.toastContent}>
        <Icon name={iconName} size={18} color={palette.white} />
        <Text style={styles.toastText} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.action && (
          <Pressable
            onPress={() => {
              toast.action!.onPress();
              if (timerRef.current) clearTimeout(timerRef.current);
              dismiss();
            }}
            style={styles.actionButton}
            hitSlop={8}
          >
            <Text style={styles.actionText}>{toast.action.label}</Text>
          </Pressable>
        )}
      </View>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[styles.progressBar, progressAnimatedStyle]}
        />
      </View>
    </Animated.View>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((payload: ToastPayload) => {
    const id = ++idRef.current;
    const toast: ToastMessage = {
      id,
      message: payload.message,
      type: payload.type,
      action: payload.action,
      duration: payload.duration || DEFAULT_DURATION,
      icon: payload.icon,
    };
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), toast]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unsub = toastEmitter.subscribe(addToast);
    return unsub;
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <View style={[styles.container, { pointerEvents: 'box-none' }]}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    borderRadius: radius.xl,
    marginBottom: spacing.sm - 2,
    ...shadows.lg,
    maxWidth: 340,
    minWidth: 200,
    overflow: 'hidden',
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.smd,
  },
  toastText: {
    color: palette.white,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  actionText: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
});
