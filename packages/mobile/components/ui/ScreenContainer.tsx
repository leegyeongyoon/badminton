import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { breakpoints, spacing } from '../../constants/theme';

export interface ScreenContainerProps {
  children: React.ReactNode;
  /**
   * Max content width on tablet/desktop. Default ~760 suits reading-oriented
   * single-column screens (home / my-status / more). Pass a larger value for
   * dense, multi-column surfaces.
   */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Centered, width-capped wrapper for tablet/desktop. On phone widths
 * (< breakpoints.tablet) it is an inert full-width passthrough so nothing
 * regresses on mobile. On tablet/desktop it centers its children and caps
 * their width, adding a touch more horizontal breathing room on very wide
 * screens.
 *
 * Web-safe: relies only on `useResponsiveLayout` (which reads
 * `useWindowDimensions`); no direct `window`/`document` access.
 */
export function ScreenContainer({ children, maxWidth = 760, style }: ScreenContainerProps) {
  const { width } = useResponsiveLayout();

  // Phone: full-width passthrough — identical to no wrapper at all.
  if (width < breakpoints.tablet) {
    return <View style={[styles.full, style]}>{children}</View>;
  }

  // Roomier side padding once the viewport is genuinely wide.
  const horizontalPadding = width >= breakpoints.wide ? spacing.xxl : spacing.lg;

  return (
    <View style={styles.outer}>
      <View
        style={[
          styles.inner,
          { maxWidth, paddingHorizontal: horizontalPadding },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
    width: '100%',
  },
  outer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
  },
});
