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
 * uses the COMPACT single-line PlayerCard, but a 2~4자 한글 이름은 잘리면 안 되므로
 * 셀은 ~150px 이상을 확보한다(폰에서 이름 잘림 방지):
 *   <240  → 1 column
 *   240–439 → 2 columns (폰 ~330, iPad 2분할 좌측 ~410)
 *   440–619 → 3 columns (데스크톱 2분할 좌측 ~510)
 *   ≥620 → 4 columns    (태블릿 세로 ~740 등 넓은 폭)
 * Always compute from the real laid-out width of the pool area, NOT the window.
 */
export function poolColumnsFor(containerWidth: number): 1 | 2 | 3 | 4 {
  // 이름(2~4자 한글)이 잘리지 않도록 셀은 ~150px 이상 확보 — 폰은 2열로.
  if (containerWidth >= 620) return 4; // 태블릿 세로(~740) 등 넓은 폭
  if (containerWidth >= 440) return 3; // 데스크톱 2분할 좌측(~510)
  if (containerWidth >= 240) return 2; // 폰(~330), iPad 2분할 좌측(~410)
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
