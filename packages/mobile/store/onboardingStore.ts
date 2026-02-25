import { create } from 'zustand';
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

interface OnboardingState {
  hasCompletedOnboarding: boolean | null;
  isLoading: boolean;
  loadOnboarding: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasCompletedOnboarding: null,
  isLoading: true,

  loadOnboarding: async () => {
    try {
      const value = await getItem(ONBOARDING_KEY);
      set({ hasCompletedOnboarding: value === 'true', isLoading: false });
    } catch {
      set({ hasCompletedOnboarding: false, isLoading: false });
    }
  },

  completeOnboarding: async () => {
    try {
      await setItem(ONBOARDING_KEY, 'true');
    } catch {
      // Persistence failure is non-critical
    }
    set({ hasCompletedOnboarding: true });
  },
}));
