import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { palette } from '../../constants/theme';
import { useTheme } from '../../hooks/useTheme';
import { useFadeIn } from '../../utils/animations';
import { Strings } from '../../constants/strings';
import { Icon } from '../ui/Icon';
import { StatusDot } from '../ui/StatusDot';
import { AnimatedPressable } from '../ui/AnimatedPressable';

interface CheckedInUser {
  userId: string;
  userName: string;
  checkedInAt: string;
  status?: string;
}

interface CheckedInUsersListProps {
  users: CheckedInUser[];
  expanded: boolean;
  onToggle: () => void;
}

export function CheckedInUsersList({ users, expanded, onToggle }: CheckedInUsersListProps) {
  const { colors, typography, spacing, radius, shadows } = useTheme();
  const fadeStyle = useFadeIn();

  function getStatusColor(status?: string): string {
    switch (status) {
      case 'AVAILABLE': return colors.playerAvailable;
      case 'IN_TURN': return colors.playerInTurn;
      case 'RESTING': return colors.playerResting;
      default: return colors.textLight;
    }
  }

  function getStatusBgColor(status?: string): string {
    switch (status) {
      case 'AVAILABLE': return colors.secondaryLight;
      case 'IN_TURN': return colors.dangerLight;
      case 'RESTING': return colors.warningLight;
      default: return colors.divider;
    }
  }

  if (users.length === 0) return null;

  return (
    <Animated.View style={[styles.section, { marginBottom: spacing.xxl }, fadeStyle]}>
      <AnimatedPressable
        hapticType="selection"
        style={[styles.collapsibleHeader, { marginBottom: spacing.xs }]}
        onPress={onToggle}
      >
        <View style={[styles.collapsibleLeft, { gap: spacing.sm }]}>
          <Text
            style={[
              typography.subtitle1,
              { fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
            ]}
          >
            체크인 사용자
          </Text>
          <View
            style={[
              styles.userCountBadge,
              {
                backgroundColor: colors.primaryLight,
                paddingHorizontal: spacing.smd,
                paddingVertical: 3,
                borderRadius: radius.lg,
              },
            ]}
          >
            <Text style={[typography.caption, { fontWeight: '700', color: colors.primary }]}>
              {users.length}명
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.expandButton,
            {
              borderRadius: radius.md,
              backgroundColor: colors.divider,
            },
          ]}
        >
          <Icon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            size={14}
            color={colors.textSecondary}
          />
        </View>
      </AnimatedPressable>
      {expanded && (
        <View
          style={[
            styles.usersList,
            {
              backgroundColor: colors.surface,
              borderRadius: radius.card,
              ...shadows.md,
            },
          ]}
        >
          {users.map((user, index) => (
            <View
              key={user.userId}
              style={[
                styles.userRow,
                {
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  gap: spacing.md,
                },
                index > 0 && { borderTopWidth: 1, borderTopColor: colors.divider },
              ]}
            >
              <View
                style={[
                  styles.userAvatar,
                  {
                    borderRadius: radius.xl,
                    backgroundColor:
                      colors.avatarColors[
                        user.userName.charCodeAt(0) % colors.avatarColors.length
                      ],
                  },
                ]}
              >
                <Text style={[typography.button, { color: palette.white }]}>
                  {user.userName.charAt(0)}
                </Text>
              </View>
              <View style={styles.userNameContainer}>
                <Text style={[typography.button, { color: colors.text }]}>
                  {user.userName}
                </Text>
                <Text
                  style={[
                    typography.caption,
                    { color: colors.textLight, marginTop: 2 },
                  ]}
                >
                  {new Date(user.checkedInAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View
                style={[
                  styles.userStatusBadge,
                  {
                    backgroundColor: getStatusBgColor(user.status),
                    gap: 5,
                    paddingHorizontal: spacing.smd,
                    paddingVertical: 5,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <StatusDot color={getStatusColor(user.status)} size="sm" />
                <Text
                  style={[
                    typography.caption,
                    { fontWeight: '700', color: getStatusColor(user.status) },
                  ]}
                >
                  {Strings.player.status[
                    user.status as keyof typeof Strings.player.status
                  ] ||
                    user.status ||
                    '대기'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {},
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userCountBadge: {},
  expandButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  usersList: {
    overflow: 'hidden',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userNameContainer: {
    flex: 1,
  },
  userStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
