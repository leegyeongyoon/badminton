import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { StatusDot } from '../ui/StatusDot';

interface CapacityOverviewProps {
  capacity: {
    totalCheckedIn: number;
    availableCount: number;
    inTurnCount: number;
    restingCount: number;
    totalCourts: number;
    activeCourts: number;
  } | null;
}

export function CapacityOverview({ capacity }: CapacityOverviewProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();
  const fadeStyle = useFadeIn();

  if (!capacity) return null;

  const total = capacity.totalCheckedIn;

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
        {Strings.admin.capacityOverview}
      </Text>
      <View style={[styles.statsGrid, { gap: spacing.smd }]}>
        <View
          style={[
            styles.statCard,
            {
              backgroundColor: colors.primaryLight,
              borderRadius: radius.xxl,
              padding: spacing.mlg,
            },
          ]}
        >
          <Text style={[styles.statValue, { color: colors.primary }]}>
            {capacity.totalCheckedIn}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.primary, marginTop: spacing.xs },
            ]}
          >
            총 체크인
          </Text>
        </View>
        <View
          style={[
            styles.statCard,
            {
              backgroundColor: colors.secondaryLight,
              borderRadius: radius.xxl,
              padding: spacing.mlg,
            },
          ]}
        >
          <Text style={[styles.statValue, { color: colors.secondary }]}>
            {capacity.availableCount}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.secondary, marginTop: spacing.xs },
            ]}
          >
            {Strings.capacity.available}
          </Text>
        </View>
        <View
          style={[
            styles.statCard,
            {
              backgroundColor: colors.dangerLight,
              borderRadius: radius.xxl,
              padding: spacing.mlg,
            },
          ]}
        >
          <Text style={[styles.statValue, { color: colors.danger }]}>
            {capacity.inTurnCount}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.danger, marginTop: spacing.xs },
            ]}
          >
            {Strings.capacity.inTurn}
          </Text>
        </View>
        <View
          style={[
            styles.statCard,
            {
              backgroundColor: colors.warningLight,
              borderRadius: radius.xxl,
              padding: spacing.mlg,
            },
          ]}
        >
          <Text style={[styles.statValue, { color: colors.warning }]}>
            {capacity.restingCount}
          </Text>
          <Text
            style={[
              typography.overline,
              { color: colors.warning, marginTop: spacing.xs },
            ]}
          >
            {Strings.capacity.resting}
          </Text>
        </View>
      </View>
      {total > 0 && (
        <View
          style={[
            styles.capacityBarContainer,
            {
              marginTop: spacing.md,
              backgroundColor: colors.surface,
              borderRadius: radius.xxl,
              padding: spacing.lg,
              ...shadows.sm,
            },
          ]}
        >
          <View
            style={[
              styles.capacityProgressBar,
              {
                borderRadius: radius.sm,
                backgroundColor: colors.divider,
                marginBottom: spacing.md,
              },
            ]}
          >
            {capacity.availableCount > 0 && (
              <View
                style={[
                  styles.capacitySegment,
                  {
                    flex: capacity.availableCount / total,
                    backgroundColor: colors.playerAvailable,
                    borderTopLeftRadius: radius.sm,
                    borderBottomLeftRadius: radius.sm,
                  },
                ]}
              />
            )}
            {capacity.inTurnCount > 0 && (
              <View
                style={[
                  styles.capacitySegment,
                  {
                    flex: capacity.inTurnCount / total,
                    backgroundColor: colors.playerInTurn,
                  },
                ]}
              />
            )}
            {capacity.restingCount > 0 && (
              <View
                style={[
                  styles.capacitySegment,
                  {
                    flex: capacity.restingCount / total,
                    backgroundColor: colors.playerResting,
                    borderTopRightRadius: radius.sm,
                    borderBottomRightRadius: radius.sm,
                  },
                ]}
              />
            )}
          </View>
          <View style={[styles.capacityLegend, { gap: spacing.xl }]}>
            <View style={[styles.legendItem, { gap: spacing.sm }]}>
              <StatusDot color={colors.playerAvailable} size="lg" />
              <Text
                style={[
                  typography.buttonSm,
                  { fontWeight: '600', color: colors.textSecondary },
                ]}
              >
                {Strings.capacity.available} {capacity.availableCount}
              </Text>
            </View>
            <View style={[styles.legendItem, { gap: spacing.sm }]}>
              <StatusDot color={colors.playerInTurn} size="lg" />
              <Text
                style={[
                  typography.buttonSm,
                  { fontWeight: '600', color: colors.textSecondary },
                ]}
              >
                {Strings.capacity.inTurn} {capacity.inTurnCount}
              </Text>
            </View>
            <View style={[styles.legendItem, { gap: spacing.sm }]}>
              <StatusDot color={colors.playerResting} size="lg" />
              <Text
                style={[
                  typography.buttonSm,
                  { fontWeight: '600', color: colors.textSecondary },
                ]}
              >
                {Strings.capacity.resting} {capacity.restingCount}
              </Text>
            </View>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {},
  statsGrid: {
    flexDirection: 'row',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
  },
  capacityBarContainer: {},
  capacityProgressBar: {
    flexDirection: 'row',
    height: 10,
    overflow: 'hidden',
  },
  capacitySegment: {
    height: 10,
  },
  capacityLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
