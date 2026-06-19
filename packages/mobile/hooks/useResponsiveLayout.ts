import { useWindowDimensions } from 'react-native';

export interface ResponsiveLayout {
  width: number;
  height: number;
  /** Tablet-class width (>= 768pt). */
  isTablet: boolean;
  /** Wider than tall. */
  isLandscape: boolean;
  /** Suggested column count for grid layouts. */
  columns: 1 | 2 | 3;
  /**
   * Use the side-by-side TWO-PANE operator layout only on genuinely wide
   * screens (>= 1200pt). Below that — tablets in portrait (768/834), narrow
   * laptops, phones — a single-column stacked layout keeps every cell wide
   * enough that 2–4 char Korean names never clip. (See operate.tsx.)
   */
  twoPane: boolean;
}

/**
 * Maps an ACTUAL container width (px) to a court-grid column count, sized so
 * each court stays wide enough that its inner 2×2 player cell is ≥ ~150px and
 * Korean names (13–14px) never truncate:
 *   <560  → 1 column   (very narrow / phone)
 *   560–1099 → 2 columns
 *   ≥1100 → 3 columns
 * Always compute from the real laid-out width, NOT the window width, because
 * the courts live inside a padded pane.
 */
export function courtColumnsFor(containerWidth: number): 1 | 2 | 3 {
  if (containerWidth >= 1100) return 3;
  if (containerWidth >= 560) return 2;
  return 1;
}

/**
 * Pure layout hook driven by window dimensions. Re-renders on resize/rotation.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();

  return {
    width,
    height,
    isTablet: width >= 768,
    isLandscape: width > height,
    columns: width >= 1100 ? 3 : width >= 768 ? 2 : 1,
    twoPane: width >= 1200,
  };
}
