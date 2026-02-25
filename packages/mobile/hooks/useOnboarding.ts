import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ONBOARDING_KEY = 'badminton_onboarding_completed';

/** Web-safe storage helpers (SecureStore is native-only) */
async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch { /* noop */ }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

/**
 * Manages onboarding completion state.
 * Persists the flag in expo-secure-store (native) or localStorage (web).
 */
export function useOnboarding() {
  const [hasCompletedOnboarding, setHasCompleted] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getItem(ONBOARDING_KEY)
      .then((value) => {
        setHasCompleted(value === 'true');
      })
      .catch(() => {
        setHasCompleted(false);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      await setItem(ONBOARDING_KEY, 'true');
    } catch {
      // Persistence failure is non-critical
    }
    setHasCompleted(true);
  }, []);

  return { hasCompletedOnboarding, completeOnboarding, isLoading };
}
