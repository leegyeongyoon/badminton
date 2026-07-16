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
 * Maps an ACTUAL container width (px) to a player-pool grid column count. Mode 1
 * now uses the COMPACT single-line PlayerCard (급수 avatar + 이름 + 작은 게임수),
 * so each cell only needs ~100–115px — denser than the old 2-line card. We aim
 * for 4명 한 줄 on the common operator widths:
 *   <220  → 1 column   (아주 좁은 폰)
 *   220–319 → 2 columns
 *   320–459 → 3 columns (iPad 2분할 좌측 ~410)
 *   ≥460 → 4 columns    (데스크톱 2분할 좌측 ~510 · 태블릿 세로 · 넓은 폰)
 * Always compute from the real laid-out width of the pool area, NOT the window.
 * At 4 cols / 460px each cell is ~112px → comfortable for the compact one-liner.
 */
export function poolColumnsFor(containerWidth: number): 1 | 2 | 3 | 4 {
  if (containerWidth >= 460) return 4;
  if (containerWidth >= 320) return 3;
  if (containerWidth >= 220) return 2;
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
