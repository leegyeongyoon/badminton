import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'feature_';

/**
 * Tracks whether a feature tooltip has been shown to the user.
 * Persists the "seen" flag in expo-secure-store.
 */
export function useFeatureHighlight(featureKey: string) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(`${PREFIX}${featureKey}`)
      .then((value) => {
        if (value !== 'seen') {
          setShouldShow(true);
        }
      })
      .catch(() => {
        // On error, show the tooltip anyway
        setShouldShow(true);
      });
  }, [featureKey]);

  const markSeen = useCallback(async () => {
    setShouldShow(false);
    try {
      await SecureStore.setItemAsync(`${PREFIX}${featureKey}`, 'seen');
    } catch {
      // Persistence failure is non-critical
    }
  }, [featureKey]);

  return { shouldShow, markSeen };
}
