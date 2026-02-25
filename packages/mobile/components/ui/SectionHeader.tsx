import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { Icon } from './Icon';

interface SectionHeaderProps {
  title: string;
  count?: number;
  action?: { label: string; onPress: () => void };
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SectionHeader({
  title,
  count,
  action,
  collapsible,
  collapsed,
  onToggle,
}: SectionHeaderProps) {
  const { colors } = useTheme();

  const titleContent = (
    <View style={styles.left}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {count != null && (
        <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.countText, { color: colors.textInverse }]}>{count}</Text>
        </View>
      )}
      {collapsible && (
        <Icon
          name={collapsed ? 'chevronDown' : 'chevronUp'}
          size={16}
          color={colors.textLight}
        />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {collapsible && onToggle ? (
        <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.left}>
          {titleContent}
        </TouchableOpacity>
      ) : (
        titleContent
      )}
      {action && (
        <TouchableOpacity onPress={action.onPress} activeOpacity={0.7}>
          <Text style={[styles.action, { color: colors.primary }]}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.subtitle1.fontSize,
    fontWeight: typography.subtitle1.fontWeight,
    letterSpacing: 0.3,
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
  },
  action: {
    fontSize: typography.buttonSm.fontSize,
    fontWeight: typography.buttonSm.fontWeight,
  },
});
