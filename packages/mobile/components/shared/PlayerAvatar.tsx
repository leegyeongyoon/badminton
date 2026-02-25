import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { palette } from '../../constants/theme';
import { playerAvatarLabel } from '../../utils/accessibility';

interface PlayerAvatarProps {
  name: string;
  size?: number;
  accessibilityLabel?: string;
  status?: string;
  avatarUrl?: string;
}

function PlayerAvatarInner({ name, size = 24, accessibilityLabel: a11yLabel, status }: PlayerAvatarProps) {
  const { colors } = useTheme();
  const colorIndex = name.charCodeAt(0) % colors.avatarColors.length;
  const bg = colors.avatarColors[colorIndex];
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
      accessibilityLabel={a11yLabel || playerAvatarLabel(name, status)}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{name[0]}</Text>
    </View>
  );
}

function arePropsEqual(prev: PlayerAvatarProps, next: PlayerAvatarProps): boolean {
  return prev.name === next.name && prev.avatarUrl === next.avatarUrl && prev.size === next.size;
}

export const PlayerAvatar = React.memo(PlayerAvatarInner, arePropsEqual);

const styles = StyleSheet.create({
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: palette.white,
    fontWeight: '700',
  },
});
