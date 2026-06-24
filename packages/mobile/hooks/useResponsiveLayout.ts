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
   * Use the side-by-side TWO-PANE operator layout on genuinely wide screens
   * (>= 1200pt) AND on tablet LANDSCAPE (>= 1024pt wider-than-tall, e.g. an
   * iPad in landscape ~1024–1180). Below that — tablets in portrait (768/834),
   * narrow laptops, phones — a single-column stacked layout keeps every cell
   * wide enough that 2–4 char Korean names never clip. (See operate.tsx.)
   */
  twoPane: boolean;
}

/**
 * Maps an ACTUAL container width (px) to a player-pool grid column count. Pool
 * cards hold a 급수 avatar + a 2–4 char Korean name + 게임수, so each cell wants
 * to stay ≥ ~150px wide:
 *   <380  → 1 column   (narrow phone)
 *   380–479 → 2 columns (phone landscape / iPad two-pane left column ~410)
 *   480–899 → 3 columns (desktop two-pane left column ~510)
 *   ≥900 → 4 columns   (full-width pool on a very wide stacked layout)
 * Always compute from the real laid-out width of the pool area, NOT the window.
 * At 3 cols / 480px each cell is ~155px → still clears the ~150px name target.
 */
export function poolColumnsFor(containerWidth: number): 1 | 2 | 3 | 4 {
  if (containerWidth >= 900) return 4;
  if (containerWidth >= 480) return 3;
  if (containerWidth >= 380) return 2;
  return 1;
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
  const isLandscape = width > height;

  return {
    width,
    height,
    isTablet: width >= 768,
    isLandscape,
    columns: width >= 1100 ? 3 : width >= 768 ? 2 : 1,
    // Two-pane on genuinely wide screens, OR on a tablet held in LANDSCAPE
    // (>= 1024 — an iPad landscape is ~1024–1180) so the operator gets the
    // pool | courts split. Portrait tablets / phones stay single-column.
    twoPane: width >= 1200 || (isLandscape && width >= 1024),
  };
}
