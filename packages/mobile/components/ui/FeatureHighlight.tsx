import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useFeatureHighlight } from '../../hooks/useFeatureHighlight';
import { Tooltip } from './Tooltip';

interface FeatureHighlightProps {
  featureKey: string;
  message: string;
  position?: 'top' | 'bottom';
  children: React.ReactNode;
}

/**
 * Wraps children and shows a tooltip the first time the feature is seen.
 * Tracks "seen" status via useFeatureHighlight hook.
 */
export function FeatureHighlight({
  featureKey,
  message,
  position = 'bottom',
  children,
}: FeatureHighlightProps) {
  const { shouldShow, markSeen } = useFeatureHighlight(featureKey);

  return (
    <View style={styles.wrapper}>
      {children}
      <Tooltip
        visible={shouldShow}
        message={message}
        position={position}
        onDismiss={markSeen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    position: 'relative',
  },
});
