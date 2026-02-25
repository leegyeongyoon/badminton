import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { palette } from '../../constants/theme';
import { PlayerAvatar } from './PlayerAvatar';

interface Player {
  id: string;
  userName: string;
}

interface PlayerAvatarRowProps {
  players: Player[];
  max?: number;
  avatarSize?: number;
}

function PlayerAvatarRowInner({ players, max = 4, avatarSize = 26 }: PlayerAvatarRowProps) {
  const { colors } = useTheme();
  const shown = players.slice(0, max);
  const extra = players.length - max;
  return (
    <View style={styles.row}>
      {shown.map((p, i) => (
        <View key={p.id} style={[styles.wrap, { borderColor: colors.surface }, i > 0 && { marginLeft: -6 }]}>
          <PlayerAvatar name={p.userName} size={avatarSize} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.wrap, { borderColor: colors.surface, marginLeft: -6 }]}>
          <View style={[styles.extra, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: colors.textLight }]}>
            <Text style={styles.extraText}>+{extra}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function arePropsEqual(prev: PlayerAvatarRowProps, next: PlayerAvatarRowProps): boolean {
  if (prev.players.length !== next.players.length) return false;
  if (prev.max !== next.max) return false;
  if (prev.avatarSize !== next.avatarSize) return false;
  for (let i = 0; i < prev.players.length; i++) {
    if (prev.players[i].id !== next.players[i].id) return false;
  }
  return true;
}

export const PlayerAvatarRow = React.memo(PlayerAvatarRowInner, arePropsEqual);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    flexShrink: 1,
  },
  wrap: {
    borderWidth: 2,
    borderRadius: 15,
  },
  extra: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  extraText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '700',
  },
});
