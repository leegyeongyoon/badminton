/**
 * Performance utility hooks.
 */
import React, { useCallback, useRef, useState, useEffect } from 'react';

/**
 * Like useCallback but with a stable reference.
 * The latest callback is always called, but the ref never changes.
 */
export function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback((...args: any[]) => ref.current(...args), []) as T;
}

/**
 * Debounce a value change.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Memoize a list's renderItem to prevent unnecessary re-renders.
 */
export function useStableRenderItem<T>(
  renderItem: (info: { item: T; index: number }) => React.ReactElement | null,
  deps: any[],
) {
  return useCallback(renderItem, deps);
}
