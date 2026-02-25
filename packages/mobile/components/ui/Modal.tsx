import React, { useEffect } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
  DimensionValue,
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

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  width?: DimensionValue;
}

export function Modal({
  visible,
  onClose,
  title,
  children,
  actions,
  width = '85%',
}: ModalProps) {
  const { colors } = useTheme();
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
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[styles.card, { width, backgroundColor: colors.surface }, cardAnimatedStyle]}
          accessibilityViewIsModal={true}
          accessibilityLabel={title}
        >
          {title && <Text style={[styles.title, { color: colors.text }]}>{title}</Text>}
          <View>{children}</View>
          {actions && <View style={styles.actions}>{actions}</View>}
        </Animated.View>
      </View>
    </RNModal>
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
    maxHeight: '85%',
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.lg,
  },
  actions: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
});
