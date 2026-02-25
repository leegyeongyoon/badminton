import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../hooks/useTheme';
import { useCheckinStore } from '../../store/checkinStore';
import { palette, typography, spacing, radius } from '../../constants/theme';
import { useFadeIn } from '../../utils/animations';

export function ActivityEmptyState() {
  const { colors, shadows } = useTheme();
  const { status: checkinStatus } = useCheckinStore();
  const router = useRouter();
  const fadeInStyle = useFadeIn();
  const isCheckedIn = !!checkinStatus;

  return (
    <Animated.View style={[styles.container, fadeInStyle]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryBg }]}>
        <Icon name={isCheckedIn ? 'waiting' : 'court'} size={48} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        {isCheckedIn ? '아직 게임 기록이 없어요' : '아직 활동 내역이 없어요'}
      </Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {isCheckedIn
          ? '현황판에서 코트를 탭하면\n바로 순번을 등록할 수 있어요'
          : '체크인하면 코트 순번 등록과\n게임 기록을 확인할 수 있어요'}
      </Text>
      <View style={styles.actions}>
        {isCheckedIn ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }, shadows.colored(colors.primary)]}
            onPress={() => router.push('/(tabs)')}
            activeOpacity={0.8}
          >
            <Icon name="court" size={18} color={palette.white} />
            <Text style={styles.primaryBtnText}>현황판으로 이동</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }, shadows.colored(colors.primary)]}
            onPress={() => router.push('/checkin-modal')}
            activeOpacity={0.8}
          >
            <Icon name="camera" size={18} color={palette.white} />
            <Text style={styles.primaryBtnText}>체크인하기</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxxl,
    paddingHorizontal: spacing.xxxl,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.xxl * 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  description: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    marginTop: spacing.xxl,
    gap: spacing.md,
    alignItems: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.mlg,
    borderRadius: radius.pill,
  },
  primaryBtnText: {
    color: palette.white,
    ...typography.button,
  },
});
