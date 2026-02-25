import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { StatusDot } from '../ui/StatusDot';

interface AdminHeaderProps {
  facilityName: string | undefined;
  isLive: boolean;
  sessionStartTime?: string;
}

function formatDuration(startTime: string): string {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const diffMs = now - start;
  if (diffMs < 0) return '운영 0분';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `운영 ${hours}시간 ${minutes}분`;
  return `운영 ${minutes}분`;
}

export function AdminHeader({ facilityName, isLive, sessionStartTime }: AdminHeaderProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const fadeStyle = useFadeIn();

  const durationText = useMemo(() => {
    if (!isLive || !sessionStartTime) return null;
    return formatDuration(sessionStartTime);
  }, [isLive, sessionStartTime]);

  return (
    <Animated.View style={[styles.headerContainer, { marginBottom: spacing.xl }, fadeStyle]}>
      <View>
        <Text style={[typography.h1, { color: colors.text, marginBottom: spacing.xs }]}>
          {Strings.admin.dashboard}
        </Text>
        <Text style={[typography.body2, { color: colors.textSecondary }]}>
          {facilityName}
        </Text>
      </View>
      {isLive && (
        <View
          style={[
            styles.liveIndicator,
            {
              backgroundColor: colors.secondaryLight,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radius.pill,
              gap: spacing.sm,
              marginTop: spacing.xs,
            },
          ]}
        >
          <StatusDot color={colors.secondary} size="md" pulse />
          <View>
            <Text style={[typography.buttonSm, { color: colors.secondary }]}>운영 중</Text>
            {durationText && (
              <Text style={[typography.caption, { color: colors.secondary, marginTop: 1 }]}>
                {durationText}
              </Text>
            )}
          </View>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
