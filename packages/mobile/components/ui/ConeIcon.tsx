import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';

interface ConeIconProps {
  size?: number;
  filled?: boolean;
  color?: string;
  dimmed?: boolean;
}

export function ConeIcon({ size = 20, filled = true, color, dimmed = false }: ConeIconProps) {
  const { colors } = useTheme();
  const coneColor = color || (filled ? colors.primary : colors.border);
  const coneOpacity = dimmed ? 0.35 : 1;

  const triangleSize = size;
  const baseWidth = triangleSize * 0.7;

  return (
    <View style={[styles.container, { width: size, height: size, opacity: coneOpacity }]}>
      {/* Triangle cone shape using borders */}
      <View
        style={[
          styles.triangle,
          {
            borderLeftWidth: baseWidth / 2,
            borderRightWidth: baseWidth / 2,
            borderBottomWidth: triangleSize * 0.75,
            borderBottomColor: coneColor,
          },
        ]}
      />
      {/* Base rectangle */}
      <View
        style={[
          styles.base,
          {
            width: baseWidth * 1.1,
            height: size * 0.15,
            backgroundColor: coneColor,
            borderRadius: size * 0.05,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderStyle: 'solid',
  },
  base: {},
});
