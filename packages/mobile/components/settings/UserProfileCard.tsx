import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { Strings } from '../../constants/strings';
import { Icon, IconName } from '../ui/Icon';
import { Chip } from '../ui/Chip';
import { PlayerAvatar } from '../shared/PlayerAvatar';
import { typography, radius, spacing } from '../../constants/theme';
import { alpha } from '../../utils/color';
import { useFadeIn } from '../../utils/animations';
import { getSkillMeta } from '../../constants/skill';

// ─── Game Type Config ────────────────────────────────────────
const GAME_TYPE_LABELS: Record<string, { label: string; icon: IconName }> = {
  SINGLES: { label: '단식', icon: 'court' },
  DOUBLES: { label: '복식', icon: 'court' },
  MIXED_DOUBLES: { label: '혼합복식', icon: 'people' },
};

// ─── Props ───────────────────────────────────────────────────
interface UserProfileCardProps {
  user: { name?: string; phone?: string | null } | null;
  profileData: any;
  onEditProfile: () => void;
}

// ─── Component ───────────────────────────────────────────────
export function UserProfileCard({ user, profileData, onEditProfile }: UserProfileCardProps) {
  const { colors, shadows } = useTheme();
  const fadeInStyle = useFadeIn();

  const userName = user?.name || '?';
  const skillLevel: string | null = profileData?.skillLevel ?? null;
  // Always show a 급수 chip: the LETTER + criteria when set, or "급수 미설정"
  // (muted) when unset — never the old 상/중하 word-labels.
  const skillMeta = getSkillMeta(skillLevel);
  const skillChipLabel = skillLevel
    ? `${skillMeta.level} · ${skillMeta.description}`
    : '급수 미설정';
  const gameTypes: string[] = profileData?.preferredGameTypes || [];

  return (
    <Animated.View style={[styles.card, { backgroundColor: colors.surface }, shadows.md, fadeInStyle]}>
      {/* Avatar with gradient ring */}
      <View style={styles.avatarContainer}>
        <View style={[styles.avatarRing, { borderColor: alpha(colors.primary, 0.25) }]}>
          <PlayerAvatar name={userName} size={64} />
        </View>
      </View>

      {/* User Name */}
      <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
        {userName}
      </Text>

      {/* Phone Number */}
      {user?.phone ? (
        <Text style={[styles.userPhone, { color: colors.textSecondary }]}>{user.phone}</Text>
      ) : null}

      {/* Skill Level Chip — letter + criteria (or "급수 미설정" when unset) */}
      <View style={styles.skillRow}>
        <Chip
          label={skillChipLabel}
          variant={skillLevel ? 'filled' : 'outline'}
          color={skillMeta.color}
          icon="medal"
        />
      </View>

      {/* Preferred Game Types */}
      {gameTypes.length > 0 && (
        <View style={styles.gameTypesRow}>
          {gameTypes.map((gt) => {
            const config = GAME_TYPE_LABELS[gt];
            return (
              <Chip
                key={gt}
                label={config?.label || gt}
                variant="outline"
                size="sm"
                icon={config?.icon}
              />
            );
          })}
        </View>
      )}

      {/* Edit Profile Button */}
      <TouchableOpacity
        style={[styles.editButton, { borderColor: colors.border }]}
        onPress={onEditProfile}
        activeOpacity={0.7}
      >
        <Icon name="edit" size={16} color={colors.primary} />
        <Text style={[styles.editButtonText, { color: colors.primary }]}>{Strings.settings.profileEdit}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.xxl,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  avatarContainer: {
    marginBottom: spacing.lg,
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },
  userPhone: {
    ...typography.caption,
    marginBottom: spacing.md,
  },
  skillRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  gameTypesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  editButtonText: {
    ...typography.button,
  },
});
