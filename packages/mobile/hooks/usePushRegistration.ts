import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/auth';

/**
 * Registers the device's Expo push token with the backend, once per
 * authenticated session. Native-only — entirely a no-op on web.
 *
 * Resolves the EAS projectId from app config; if it's missing it logs a
 * warning and no-ops rather than crashing (push simply stays disabled).
 */
async function registerForPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    // Android requires a notification channel for foreground/heads-up display.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    // Only attempt registration with a real EAS projectId. The placeholder
    // ('REPLACE_WITH_EAS_PROJECT_ID') ships before the user runs `eas init`,
    // and a real id is a UUID — anything else means push isn't set up yet, so
    // we no-op instead of letting getExpoPushTokenAsync throw.
    const isRealProjectId =
      typeof projectId === 'string' &&
      projectId.length > 0 &&
      projectId !== 'REPLACE_WITH_EAS_PROJECT_ID';

    if (!isRealProjectId) {
      console.warn(
        '[push] No real EAS projectId in app config (extra.eas.projectId is missing or still the placeholder); skipping push token registration.'
      );
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) {
      await authApi.updatePushToken(token);
    }
  } catch (err) {
    console.warn('[push] Failed to register push token:', err);
  }
}

/**
 * Runs push registration once after the user becomes authenticated.
 * No-op on web and before auth.
 */
export function usePushRegistration() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isAuthenticated) {
      registeredRef.current = false;
      return;
    }
    if (registeredRef.current) return;
    registeredRef.current = true;
    registerForPushNotifications();
  }, [isAuthenticated]);
}
