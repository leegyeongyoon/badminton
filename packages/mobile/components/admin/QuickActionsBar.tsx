import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { alpha } from '../../constants/colors';
import { palette } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { AnimatedPressable } from '../ui/AnimatedPressable';

interface QuickActionsBarProps {
  isSessionActive: boolean;
  onToggleSession: () => void;
  onViewRotation: () => void;
  onViewPenalties: () => void;
}

export function QuickActionsBar({
  isSessionActive,
  onToggleSession,
  onViewRotation,
  onViewPenalties,
}: QuickActionsBarProps) {
  const { colors, typography, spacing, radius, shadows, opacity } = useTheme();

  return (
    <>
      <View style={[styles.quickActions, { gap: spacing.md, marginBottom: spacing.md }]}>
        <AnimatedPressable
          hapticType="medium"
          style={[
            styles.quickBtn,
            {
              paddingVertical: spacing.lg,
              borderRadius: radius.card,
              gap: spacing.xs,
              backgroundColor: isSessionActive ? colors.danger : colors.secondary,
              ...shadows.lg,
            },
          ]}
          onPress={onToggleSession}
        >
          <Icon name={isSessionActive ? 'stop' : 'play'} size={20} color={palette.white} />
          <Text style={[typography.button, { color: palette.white }]}>
            {isSessionActive ? Strings.admin.sessionClose : Strings.admin.sessionOpen}
          </Text>
        </AnimatedPressable>
        <AnimatedPressable
          hapticType="light"
          style={[
            styles.quickBtn,
            {
              paddingVertical: spacing.lg,
              borderRadius: radius.card,
              gap: spacing.xs,
              backgroundColor: colors.primary,
              ...shadows.lg,
            },
          ]}
          onPress={onViewRotation}
        >
          <Icon name="rotation" size={20} color={palette.white} />
          <Text style={[typography.button, { color: palette.white }]}>
            {Strings.admin.viewRotation}
          </Text>
        </AnimatedPressable>
      </View>
      <AnimatedPressable
        hapticType="light"
        style={[
          styles.penaltyButton,
          {
            backgroundColor: colors.warningLight,
            borderRadius: radius.xxl,
            marginBottom: spacing.xxl,
            borderWidth: 1,
            borderColor: alpha(colors.warning, opacity.border),
          },
        ]}
        onPress={onViewPenalties}
      >
        <View
          style={[
            styles.penaltyInner,
            {
              paddingVertical: spacing.mlg,
              paddingHorizontal: spacing.xl - 2,
              gap: spacing.smd,
            },
          ]}
        >
          <Icon name="warning" size={20} color={colors.warning} />
          <Text style={[typography.button, { flex: 1, color: colors.warning }]}>
            패널티 관리
          </Text>
          <Text style={{ fontSize: 22, color: colors.warning, fontWeight: '300' }}>
            ›
          </Text>
        </View>
      </AnimatedPressable>
    </>
  );
}

const styles = StyleSheet.create({
  quickActions: {
    flexDirection: 'row',
  },
  quickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  penaltyButton: {},
  penaltyInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
