/**
 * useViewportVisibility - Determines if an element is visible in the viewport.
 * Simplified implementation: returns true after first mount + small delay.
 * Can be extended with onLayout + scroll position for true viewport tracking.
 */
import { useState, useEffect } from 'react';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export function useViewportVisibility(_ref: RefObject<View>, delay = 100) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timeout);
  }, [delay]);

  return { isVisible };
}
