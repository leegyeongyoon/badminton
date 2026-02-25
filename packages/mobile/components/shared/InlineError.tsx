import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { Icon } from '../ui/Icon';

interface InlineErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function InlineError({
  message = '데이터를 불러올 수 없습니다.',
  onRetry,
}: InlineErrorProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Icon name="error" size={18} color={colors.danger} />
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {message}
      </Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={[styles.retryText, { color: colors.primary }]}>
            다시 시도
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  message: {
    ...typography.caption,
    flex: 1,
  },
  retryText: {
    ...typography.caption,
    fontWeight: '700',
  },
});
