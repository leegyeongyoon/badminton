import React, { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { palette, typography, spacing } from '../../constants/theme';
import { Icon } from '../ui/Icon';
import { useServerDown } from '../../hooks/useServerDown';

// ── 서버 점검 전역 배너 ────────────────────────────────────────
// 기기는 온라인인데 서버(파이)가 응답하지 않을 때 모든 화면 상단에 표시.
// - 로그인 화면은 자체 점검 카드가 있어 제외
// - 기기 오프라인/재연결은 NetworkStatusBar 담당 → suppress로 중복 방지
// NetworkStatusBar와 같은 애니메이션·배치 패턴을 쓴다.
export function ServerDownBanner({ suppress = false }: { suppress?: boolean }) {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const down = useServerDown(30_000);
  // -200: 노치 아이폰에서 바가 완전히 숨도록 넉넉히 (NetworkStatusBar와 동일).
  const translateY = useSharedValue(-200);

  const shouldShow = down && !suppress && segments[0] !== '(auth)';

  useEffect(() => {
    if (shouldShow) {
      translateY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
    } else {
      translateY.value = withDelay(
        400,
        withTiming(-200, { duration: 300, easing: Easing.in(Easing.cubic) }),
      );
    }
  }, [shouldShow]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.xs, pointerEvents: 'none' as const },
        animatedStyle,
      ]}
    >
      <Icon name="warning" size={16} color={palette.white} />
      <Text style={styles.text}>서버 점검 중이에요 — 복구되면 자동으로 정상화돼요</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: palette.red500,
  },
  text: {
    color: palette.white,
    ...typography.caption,
    fontWeight: '700',
  },
});
