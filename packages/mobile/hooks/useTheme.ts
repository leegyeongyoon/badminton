import { useThemeContext } from '../contexts/ThemeContext';

/**
 * Returns the current theme from ThemeContext.
 * Supports light, dark, and system theme modes.
 */
export function useTheme() {
  return useThemeContext();
}
