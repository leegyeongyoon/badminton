/**
 * useLazyScreen - Defers rendering until after interactions complete.
 * Uses InteractionManager.runAfterInteractions to avoid jank during
 * tab transitions and screen mounts.
 */
import { useState, useEffect } from 'react';
import { InteractionManager } from 'react-native';

export function useLazyScreen(delay = 0) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      if (delay > 0) {
        const timeout = setTimeout(() => setIsReady(true), delay);
        return () => clearTimeout(timeout);
      }
      setIsReady(true);
    });

    return () => handle.cancel();
  }, [delay]);

  return { isReady };
}
