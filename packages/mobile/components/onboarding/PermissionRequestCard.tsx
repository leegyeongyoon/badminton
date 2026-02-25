import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { Icon, IconName } from '../ui/Icon';
import { Button } from '../ui/Button';

interface PermissionRequestCardProps {
  icon: IconName;
  title: string;
  description: string;
  onAllow: () => void;
  onSkip: () => void;
}

/**
 * Permission explanation card with icon, text, and action buttons.
 * Used to request permissions (e.g., camera for QR scanning).
 */
export function PermissionRequestCard({
  icon,
  title,
  description,
  onAllow,
  onSkip,
}: PermissionRequestCardProps) {
  const { colors, shadows } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.md]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.primaryBg }]}>
        <Icon name={icon} size={32} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
      <View style={styles.actions}>
        <Button
          title="허용"
          onPress={onAllow}
          variant="primary"
          size="md"
          style={styles.allowButton}
        />
        <Button
          title="나중에"
          onPress={onSkip}
          variant="ghost"
          size="md"
          style={styles.skipButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.xxl,
    alignItems: 'center',
    marginHorizontal: spacing.xl,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.subtitle1,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.body2,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
  },
  allowButton: {
    width: '100%',
  },
  skipButton: {
    width: '100%',
  },
});
