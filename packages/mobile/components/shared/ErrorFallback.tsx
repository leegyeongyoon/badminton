import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ErrorFallbackProps {
  error: Error | null;
  onRetry?: () => void;
}

export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.dangerBg }]}>
        <Icon name="error" size={48} color={colors.danger} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        문제가 발생했습니다
      </Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {error?.message || '알 수 없는 오류가 발생했습니다.'}
      </Text>
      {onRetry && (
        <Button
          title="다시 시도"
          onPress={onRetry}
          variant="primary"
          size="md"
          icon="requeue"
          style={styles.retryButton}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  message: {
    ...typography.body2,
    textAlign: 'center',
    marginBottom: spacing.xxxl,
    lineHeight: 20,
  },
  retryButton: {
    minWidth: 160,
  },
});
