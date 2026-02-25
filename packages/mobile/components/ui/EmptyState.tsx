import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { Icon, IconName } from './Icon';
import { Button } from './Button';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  secondaryAction?: { label: string; onPress: () => void };
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, secondaryAction, compact = false }: EmptyStateProps) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <View style={[styles.compactIconWrap, { backgroundColor: colors.surface2 }]}>
          <Icon name={icon} size={24} color={colors.textLight} />
        </View>
        <View style={styles.compactTextWrap}>
          <Text style={[styles.compactTitle, { color: colors.textSecondary }]}>{title}</Text>
          {description && (
            <Text style={[styles.compactDescription, { color: colors.textLight }]}>{description}</Text>
          )}
        </View>
        {action && (
          <Button title={action.label} onPress={action.onPress} variant="ghost" size="sm" icon={action.icon} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
        <Icon name={icon} size={40} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {description && <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>}
      {action && (
        <Button
          title={action.label}
          onPress={action.onPress}
          variant="primary"
          size="md"
          icon={action.icon}
          style={styles.action}
        />
      )}
      {secondaryAction && (
        <Button
          title={secondaryAction.label}
          onPress={secondaryAction.onPress}
          variant="ghost"
          size="sm"
          style={styles.secondaryAction}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxxxl,
    paddingHorizontal: spacing.xxxl,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.subtitle1,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  description: {
    ...typography.body2,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    marginTop: spacing.xl,
  },
  secondaryAction: {
    marginTop: spacing.sm,
  },
  // Compact variant
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  compactIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactTextWrap: {
    flex: 1,
  },
  compactTitle: {
    ...typography.subtitle2,
  },
  compactDescription: {
    ...typography.caption,
    marginTop: 2,
  },
});
