/**
 * Memoization helpers for React components.
 */
import React from 'react';

/**
 * Shallow equality check for two plain objects.
 * Returns true if all own enumerable keys have strictly equal values.
 */
export function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

/**
 * Factory to create a React.memo-wrapped component with an optional
 * custom comparator. Falls back to shallowEqual when none is provided.
 */
export function createMemoComponent<P extends object>(
  component: React.FC<P>,
  propsAreEqual?: (prev: P, next: P) => boolean,
) {
  return React.memo(component, propsAreEqual ?? ((prev, next) => shallowEqual(
    prev as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
  )));
}
