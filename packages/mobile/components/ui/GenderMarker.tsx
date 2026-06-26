import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { GenderMeta } from '../../constants/gender';
import { getIconName } from './Icon';

/**
 * Robust inline gender marker (blue male / rose female).
 *
 * Renders a VECTOR icon (MaterialCommunityIcons gender-male/gender-female)
 * instead of the raw ♂/♀ Unicode glyph. Vector icons rasterize identically on
 * every device + font and have a predictable, centered glyph box — so the
 * marker never shows as tofu/□ and never drifts off the name's baseline (the
 * two failure modes of the old Unicode markers on mobile web/Android).
 *
 * Drop it anywhere a colored ♂/♀ used to sit next to a name. Place inside a
 * row with `alignItems: 'center'` and it vertically centers with the name. The
 * wrapper View carries the a11y label (남/여) so screen readers still announce
 * gender even though the glyph itself is decorative.
 */
export function GenderMarker({
  meta,
  size = 15,
  color,
}: {
  meta: GenderMeta;
  /** Match the adjacent name's font size for a balanced marker. */
  size?: number;
  /** Override the gender color (defaults to meta.color: blue ♂ / rose ♀). */
  color?: string;
}) {
  return (
    <View
      accessibilityLabel={meta.label}
      // Decorative-but-meaningful: expose the label, hide the inner glyph.
      style={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons
        name={getIconName(meta.icon) as any}
        size={size}
        color={color ?? meta.color}
      />
    </View>
  );
}
