import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { alpha } from '../../constants/colors';
import { palette } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { StatusDot } from '../ui/StatusDot';
import { AnimatedPressable } from '../ui/AnimatedPressable';

interface SessionControlProps {
  session: {
    id: string;
    status: string;
    openedByName: string;
    openedAt: string;
  } | null;
  onOpen: () => void;
  onClose: () => void;
}

export function SessionControl({ session, onOpen, onClose }: SessionControlProps) {
  const { colors, typography, spacing, radius, shadows, opacity } = useTheme();

  return (
    <View style={[styles.section, { marginBottom: spacing.xxl }]}>
      <Text
        style={[
          typography.subtitle1,
          {
            fontWeight: '800',
            color: colors.text,
            marginBottom: spacing.md,
            letterSpacing: 0.3,
          },
        ]}
      >
        운영 관리
      </Text>
      {session ? (
        <View
          style={[
            styles.sessionCard,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.xl - 2,
              ...shadows.md,
              borderLeftWidth: 4,
              borderLeftColor: colors.secondary,
            },
          ]}
        >
          <View style={[styles.sessionInfo, { gap: spacing.md }]}>
            <View
              style={[
                styles.sessionDotOuter,
                {
                  borderRadius: radius.xl,
                  backgroundColor: colors.secondaryLight,
                },
              ]}
            >
              <StatusDot color={colors.secondary} size="lg" pulse />
            </View>
            <View style={styles.sessionTextContainer}>
              <Text style={[typography.subtitle1, { color: colors.text }]}>
                운영 중
              </Text>
              <Text style={[typography.buttonSm, { color: colors.textSecondary, fontWeight: '400' }]}>
                개설자: {session.openedByName}
              </Text>
            </View>
          </View>
          <AnimatedPressable
            hapticType="medium"
            style={[
              styles.sessionCloseBtn,
              {
                paddingHorizontal: spacing.xl,
                paddingVertical: spacing.smd,
                borderRadius: radius.lg,
                backgroundColor: colors.dangerLight,
                borderWidth: 1,
                borderColor: alpha(colors.danger, opacity.border),
              },
            ]}
            onPress={onClose}
          >
            <Text style={[typography.subtitle2, { color: colors.danger }]}>
              {Strings.admin.sessionClose}
            </Text>
          </AnimatedPressable>
        </View>
      ) : (
        <AnimatedPressable
          hapticType="medium"
          style={[
            styles.sessionOpenBtn,
            {
              paddingVertical: spacing.xl - 2,
              borderRadius: radius.card,
              gap: spacing.sm,
              backgroundColor: colors.secondary,
              ...shadows.colored(colors.secondary),
            },
          ]}
          onPress={onOpen}
        >
          <Icon name="play" size={18} color={palette.white} />
          <Text style={[typography.subtitle1, { color: palette.white }]}>
            {Strings.admin.sessionOpen}
          </Text>
        </AnimatedPressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionDotOuter: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sessionTextContainer: {
    gap: 2,
  },
  sessionCloseBtn: {},
  sessionOpenBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
