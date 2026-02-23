import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
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

export function PlayerAvatarRow({ players, max = 4, avatarSize = 26 }: PlayerAvatarRowProps) {
  const shown = players.slice(0, max);
  const extra = players.length - max;
  return (
    <View style={styles.row}>
      {shown.map((p, i) => (
        <View key={p.id} style={[styles.wrap, i > 0 && { marginLeft: -6 }]}>
          <PlayerAvatar name={p.userName} size={avatarSize} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.wrap, { marginLeft: -6 }]}>
          <View style={[styles.extra, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
            <Text style={styles.extraText}>+{extra}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wrap: {
    borderWidth: 2,
    borderColor: Colors.surface,
    borderRadius: 15,
  },
  extra: {
    backgroundColor: Colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  extraText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
