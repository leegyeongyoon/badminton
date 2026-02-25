import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { springPresets, timingPresets } from '../../utils/animations';
import { Button } from './Button';
import { Strings } from '../../constants/strings';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'danger';
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = Strings.common.confirm,
  cancelLabel = Strings.common.cancel,
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  const { colors, shadows } = useTheme();
  const scale = useSharedValue(0.9);
  const cardOpacity = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, timingPresets.fast);
      scale.value = withSpring(1, springPresets.gentle);
      cardOpacity.value = withTiming(1, timingPresets.fast);
    } else {
      backdropOpacity.value = withTiming(0, timingPresets.fast);
      scale.value = withTiming(0.9, timingPresets.fast);
      cardOpacity.value = withTiming(0, timingPresets.fast);
    }
  }, [visible, scale, cardOpacity, backdropOpacity]);

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        </Animated.View>
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.surface },
            shadows.lg,
            cardAnimatedStyle,
          ]}
          accessibilityViewIsModal
          accessibilityLabel={title}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {message && (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {message}
            </Text>
          )}
          <View style={styles.actions}>
            <Button
              title={cancelLabel}
              onPress={onCancel}
              variant="outline"
              size="md"
            />
            <Button
              title={confirmLabel}
              onPress={onConfirm}
              variant={variant === 'danger' ? 'danger' : 'primary'}
              size="md"
            />
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

// ─── Global ConfirmDialog emitter ──────────────────────────────
interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel?: () => void;
}

type ConfirmListener = (request: ConfirmRequest) => void;

class ConfirmEmitter {
  private listeners: ConfirmListener[] = [];

  subscribe(fn: ConfirmListener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(request: ConfirmRequest) {
    this.listeners.forEach((fn) => fn(request));
  }
}

export const confirmEmitter = new ConfirmEmitter();

/**
 * Global ConfirmDialog container.
 * Mount once in root layout alongside ToastContainer.
 */
export function ConfirmDialogContainer() {
  const [visible, setVisible] = useState(false);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    const unsub = confirmEmitter.subscribe((req) => {
      setRequest(req);
      setVisible(true);
    });
    return unsub;
  }, []);

  const handleConfirm = useCallback(() => {
    setVisible(false);
    request?.onConfirm();
  }, [request]);

  const handleCancel = useCallback(() => {
    setVisible(false);
    request?.onCancel?.();
  }, [request]);

  if (!request) return null;

  return (
    <ConfirmDialog
      visible={visible}
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      variant={request.variant}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    width: '85%',
    maxWidth: 360,
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body2,
    marginBottom: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
});
