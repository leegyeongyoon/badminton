import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { AnimatedPressable } from '../ui/AnimatedPressable';

interface QuickActionsBarProps {
  isSessionActive: boolean;
  onToggleSession: () => void;
}

export function QuickActionsBar({
  isSessionActive,
  onToggleSession,
}: QuickActionsBarProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();

  return (
    <View style={[styles.quickActions, { gap: spacing.md, marginBottom: spacing.xxl }]}>
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
    </View>
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
});
