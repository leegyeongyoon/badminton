import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { palette } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { AnimatedPressable } from '../ui/AnimatedPressable';

interface RotationCardProps {
  rotation: {
    id: string;
    status: string;
    currentRound: number;
    totalRounds: number;
    playerCount: number;
    courtCount: number;
  } | null;
  onViewDetail: () => void;
  onGenerate: () => void;
}

export function RotationCard({ rotation, onViewDetail, onGenerate }: RotationCardProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();
  const fadeStyle = useFadeIn();

  const isActive = rotation && rotation.status !== 'COMPLETED' && rotation.status !== 'CANCELLED';

  return (
    <Animated.View style={[styles.section, { marginBottom: spacing.xxl }, fadeStyle]}>
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
        {Strings.rotation.title}
      </Text>
      {isActive ? (
        <View
          style={[
            styles.rotationCard,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              padding: spacing.xl - 2,
              ...shadows.md,
              borderLeftWidth: 4,
              borderLeftColor: colors.info,
            },
          ]}
        >
          <View
            style={[
              styles.rotationHeader,
              { gap: spacing.smd, marginBottom: spacing.md },
            ]}
          >
            <View
              style={[
                styles.rotationStatusBadge,
                {
                  backgroundColor: colors.infoLight,
                  paddingHorizontal: spacing.smd,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Text style={[typography.buttonSm, { color: colors.info }]}>
                {rotation.status === 'ACTIVE'
                  ? Strings.admin.inProgress
                  : Strings.rotation.status.DRAFT}
              </Text>
            </View>
            <Text
              style={[
                typography.subtitle2,
                { color: colors.textSecondary },
              ]}
            >
              {Strings.admin.roundLabel} {rotation.currentRound}/{rotation.totalRounds}
            </Text>
          </View>

          {/* Round progress dots */}
          <View style={[styles.roundDots, { gap: spacing.xs, marginBottom: spacing.mlg }]}>
            {Array.from({ length: rotation.totalRounds }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.roundDot,
                  {
                    backgroundColor:
                      i < rotation.currentRound ? colors.info : colors.divider,
                    borderRadius: radius.full,
                  },
                ]}
              />
            ))}
          </View>

          <View
            style={[
              styles.rotationMeta,
              { gap: spacing.lg, marginBottom: spacing.mlg },
            ]}
          >
            <View style={[styles.rotationMetaItem, { gap: spacing.sm }]}>
              <Icon name="people" size={16} color={colors.text} />
              <Text style={[typography.subtitle2, { color: colors.text }]}>
                {rotation.playerCount}명
              </Text>
            </View>
            <View style={[styles.rotationMetaItem, { gap: spacing.sm }]}>
              <Icon name="facility" size={16} color={colors.text} />
              <Text style={[typography.subtitle2, { color: colors.text }]}>
                {rotation.courtCount}코트
              </Text>
            </View>
          </View>
          <AnimatedPressable
            hapticType="light"
            style={[
              styles.rotationDetailBtn,
              {
                backgroundColor: colors.info,
                paddingVertical: spacing.md,
                borderRadius: radius.lg,
                gap: spacing.sm,
              },
            ]}
            onPress={onViewDetail}
          >
            <Text style={[typography.button, { color: palette.white }]}>상세 보기</Text>
            <Text style={{ color: palette.white, fontSize: 18, fontWeight: '300' }}>›</Text>
          </AnimatedPressable>
        </View>
      ) : (
        <AnimatedPressable
          hapticType="medium"
          style={[
            styles.generateRotationBtn,
            {
              gap: spacing.sm,
              paddingVertical: spacing.lg,
              borderRadius: radius.xxl,
              backgroundColor: colors.primary,
              ...shadows.colored(colors.primary),
            },
          ]}
          onPress={onGenerate}
        >
          <Icon name="rotation" size={18} color={palette.white} />
          <Text style={[typography.subtitle1, { color: palette.white }]}>
            {Strings.rotation.generate}
          </Text>
        </AnimatedPressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {},
  rotationCard: {},
  rotationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rotationStatusBadge: {},
  roundDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roundDot: {
    width: 8,
    height: 8,
  },
  rotationMeta: {
    flexDirection: 'row',
  },
  rotationMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rotationDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateRotationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
