/**
 * Backward-compatible Colors export.
 * All values come from the centralized theme.
 * New code should use `useTheme()` or import from `constants/theme` directly.
 */
import { lightColors } from './theme';
export { alpha, darken, lighten } from '../utils/color';

export const Colors = lightColors;
