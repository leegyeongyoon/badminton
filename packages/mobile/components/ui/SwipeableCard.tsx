/**
 * SwipeableCard
 *
 * A horizontal swipe-to-reveal card using react-native-gesture-handler's
 * PanGestureHandler and reanimated for smooth action reveal.
 *
 * - Swipe left: reveals right-side action (e.g. cancel)
 * - Swipe right: reveals left-side action (e.g. re-register)
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import {
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Icon, IconName } from './Icon';
import { haptics } from '../../utils/haptics';
import { swipeThresholds, swipeSpring } from '../../utils/gestures';
import { palette, typography, spacing, radius } from '../../constants/theme';

interface SwipeAction {
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
}

const ACTION_WIDTH = 80;

export function SwipeableCard({
  children,
  leftAction,
  rightAction,
}: SwipeableCardProps) {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);

  const triggerAction = (action: SwipeAction) => {
    haptics.light();
    action.onPress();
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((event) => {
      let newX = startX.value + event.translationX;

      // Clamp: only allow directions where actions exist
      if (!rightAction && newX > 0) newX = 0;
      if (!leftAction && newX < 0) newX = 0;

      // Clamp max distances
      if (newX > ACTION_WIDTH) newX = ACTION_WIDTH + (newX - ACTION_WIDTH) * 0.3;
      if (newX < -ACTION_WIDTH) newX = -ACTION_WIDTH + (newX + ACTION_WIDTH) * 0.3;

      translateX.value = newX;
    })
    .onEnd((event) => {
      const dist = Math.abs(translateX.value);
      const vel = Math.abs(event.velocityX);

      // Trigger right action (swipe left, translateX < 0)
      if (
        leftAction &&
        translateX.value < 0 &&
        (dist > swipeThresholds.distance || vel > swipeThresholds.velocity)
      ) {
        runOnJS(triggerAction)(leftAction);
      }

      // Trigger left action (swipe right, translateX > 0)
      if (
        rightAction &&
        translateX.value > 0 &&
        (dist > swipeThresholds.distance || vel > swipeThresholds.velocity)
      ) {
        runOnJS(triggerAction)(rightAction);
      }

      translateX.value = withSpring(0, swipeSpring);
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const leftActionStyle = useAnimatedStyle(() => ({
    opacity: translateX.value > 10 ? 1 : 0,
  }));

  const rightActionStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < -10 ? 1 : 0,
  }));

  return (
    <View style={styles.container}>
      {/* Background actions */}
      {rightAction && (
        <Animated.View
          style={[
            styles.actionContainer,
            styles.actionLeft,
            { backgroundColor: rightAction.color },
            leftActionStyle,
          ]}
        >
          <Pressable
            style={styles.actionContent}
            onPress={() => triggerAction(rightAction)}
          >
            <Icon name={rightAction.icon} size={20} color={palette.white} />
            <Text style={styles.actionLabel}>{rightAction.label}</Text>
          </Pressable>
        </Animated.View>
      )}

      {leftAction && (
        <Animated.View
          style={[
            styles.actionContainer,
            styles.actionRight,
            { backgroundColor: leftAction.color },
            rightActionStyle,
          ]}
        >
          <Pressable
            style={styles.actionContent}
            onPress={() => triggerAction(leftAction)}
          >
            <Icon name={leftAction.icon} size={20} color={palette.white} />
            <Text style={styles.actionLabel}>{leftAction.label}</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Swipeable content */}
      <GestureDetector gesture={gesture}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.xl,
    marginBottom: spacing.sm,
  },
  actionContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLeft: {
    left: 0,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
  },
  actionRight: {
    right: 0,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  actionContent: {
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    color: palette.white,
    ...typography.caption,
    fontWeight: '700',
  },
});
