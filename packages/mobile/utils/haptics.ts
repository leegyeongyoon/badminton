import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const noop = () => Promise.resolve();

/**
 * Convenience wrapper around expo-haptics.
 * Provides short, semantic method names for common haptic patterns.
 * On web, all methods are no-ops since haptics are not supported.
 */
export const haptics = Platform.OS === 'web'
  ? { light: noop, medium: noop, heavy: noop, success: noop, warning: noop, error: noop, selection: noop }
  : {
      /** Subtle tap - button presses, selections */
      light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

      /** Standard tap - confirmations, toggles */
      medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

      /** Strong tap - destructive actions, errors */
      heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

      /** Positive outcome - check-in, turn registration */
      success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

      /** Caution - timer warning, capacity full */
      warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),

      /** Negative outcome - failed action */
      error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

      /** Picker / scroll selection tick */
      selection: () => Haptics.selectionAsync(),
    };
