import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../hooks/useTheme';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { Strings } from '../../constants/strings';
import { useFadeIn } from '../../utils/animations';

interface ClubSessionCardProps {
  clubName: string;
  onPress: () => void;
}

export function ClubSessionCard({ clubName, onPress }: ClubSessionCardProps) {
  const { colors, shadows } = useTheme();
  const fadeInStyle = useFadeIn();

  return (
    <Animated.View style={fadeInStyle}>
      <TouchableOpacity style={[styles.card, { backgroundColor: colors.infoLight, ...shadows.colored(colors.info) }]} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: palette.violet200 }]}>
            <Icon name="session" size={22} color={colors.info} />
          </View>
          <View style={styles.textWrap}>
            <Text style={[styles.title, { color: colors.info }]}>{clubName}</Text>
            <Text style={[styles.status, { color: colors.info }]}>{Strings.club.sessionActive}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.lg + 2,
    marginBottom: spacing.xl,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.mlg },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWrap: { flex: 1 },
  title: { ...typography.subtitle1 },
  status: { ...typography.caption, marginTop: 2 },
});
