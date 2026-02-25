import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingScreenProps {
  title: string;
  description: string;
  illustration: React.ReactNode;
}

/**
 * Single onboarding page component.
 * Centers content vertically with title, description, and illustration.
 */
export function OnboardingScreen({ title, description, illustration }: OnboardingScreenProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { width: SCREEN_WIDTH }]}>
      <View style={styles.illustrationContainer}>{illustration}</View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
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
  illustrationContainer: {
    marginBottom: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body1,
    textAlign: 'center',
    lineHeight: 24,
  },
});
