import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

interface PlayerAvatarProps {
  name: string;
  size?: number;
}

export function PlayerAvatar({ name, size = 24 }: PlayerAvatarProps) {
  const colorIndex = name.charCodeAt(0) % Colors.avatarColors.length;
  const bg = Colors.avatarColors[colorIndex];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{name[0]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
  },
});
