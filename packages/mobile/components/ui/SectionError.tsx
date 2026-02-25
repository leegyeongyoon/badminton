import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { Icon } from './Icon';
import { Button } from './Button';

interface SectionErrorProps {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function SectionError({
  message = '데이터를 불러오지 못했습니다',
  onRetry,
  compact = false,
}: SectionErrorProps) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: colors.dangerBg, borderColor: colors.dangerLight }]}>
        <Icon name="error" size={16} color={colors.danger} />
        <Text style={[styles.compactText, { color: colors.danger }]}>{message}</Text>
        {onRetry && (
          <Button title="재시도" onPress={onRetry} variant="ghost" size="sm" />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.dangerBg }]}>
        <Icon name="error" size={32} color={colors.danger} />
      </View>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      {onRetry && (
        <Button
          title="다시 시도"
          onPress={onRetry}
          variant="outline"
          size="sm"
          icon="requeue"
          style={styles.retryButton}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  message: {
    ...typography.body2,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    marginTop: spacing.xs,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  compactText: {
    ...typography.caption,
    flex: 1,
  },
});
