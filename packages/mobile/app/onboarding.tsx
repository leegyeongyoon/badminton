import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useOnboardingStore } from '../store/onboardingStore';
import { typography, spacing, radius } from '../constants/theme';
import { timingPresets } from '../utils/animations';
import { haptics } from '../utils/haptics';
import { OnboardingScreen } from '../components/onboarding/OnboardingScreen';
import { OnboardingDots } from '../components/onboarding/OnboardingDots';
import {
  CourtIllustration,
  RegistrationIllustration,
  CommunityIllustration,
} from '../components/onboarding/OnboardingIllustration';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PAGES = [
  {
    title: '코트 예약이 이렇게 쉬워요',
    description: '체육관 코트 현황을 실시간으로 확인하고,\n빈 코트를 한눈에 찾아 바로 등록하세요.',
    illustration: <CourtIllustration />,
  },
  {
    title: '탭 한 번으로 순번 등록',
    description: '코트를 탭하고 멤버를 선택하면 끝!\n줄 서서 기다릴 필요 없이 앱에서 해결하세요.',
    illustration: <RegistrationIllustration />,
  },
  {
    title: '모임도 게임 편성도 간편하게',
    description: '함께 칠 사람 모집, 자동 게임 편성,\n활동 기록까지 한 곳에서 관리하세요.',
    illustration: <CommunityIllustration />,
  },
];

export default function OnboardingFlow() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const isLastPage = activeIndex === PAGES.length - 1;

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / SCREEN_WIDTH);
    setActiveIndex(index);
  }, []);

  const finishOnboarding = useCallback(async () => {
    await completeOnboarding();
    // Explicit navigation to login (belt-and-suspenders with layout gating)
    router.replace('/(auth)/login');
  }, [completeOnboarding, router]);

  const handleComplete = useCallback(async () => {
    try {
      haptics.success();
      await finishOnboarding();
    } catch (e) {
      console.error('[Onboarding] handleComplete error:', e);
    }
  }, [finishOnboarding]);

  const handleSkip = useCallback(async () => {
    try {
      haptics.light();
      await finishOnboarding();
    } catch (e) {
      console.error('[Onboarding] handleSkip error:', e);
    }
  }, [finishOnboarding]);

  // Animated opacity for the start button
  const buttonOpacity = useAnimatedStyle(() => ({
    opacity: withTiming(isLastPage ? 1 : 0, timingPresets.normal),
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Skip link - visible on pages 1-2 */}
      {!isLastPage && (
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip} activeOpacity={0.6}>
          <Text style={[styles.skipText, { color: colors.textSecondary }]}>건너뛰기</Text>
        </TouchableOpacity>
      )}

      {/* Pages */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        style={styles.scrollView}
      >
        {PAGES.map((page, index) => (
          <OnboardingScreen
            key={index}
            title={page.title}
            description={page.description}
            illustration={page.illustration}
          />
        ))}
      </ScrollView>

      {/* Bottom area: dots + button */}
      <View style={[styles.bottomArea, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <OnboardingDots count={PAGES.length} activeIndex={activeIndex} />

        <Animated.View style={[styles.startButtonWrapper, buttonOpacity]}>
          {isLastPage && (
            <TouchableOpacity
              style={[styles.startButton, { backgroundColor: colors.primary }]}
              onPress={handleComplete}
              activeOpacity={0.8}
            >
              <Text style={[styles.startButtonText, { color: colors.textInverse }]}>시작하기</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skipButton: {
    position: 'absolute',
    top: 60,
    right: spacing.xl,
    zIndex: 10,
    padding: spacing.sm,
  },
  skipText: {
    ...typography.body2,
  },
  scrollView: {
    flex: 1,
  },
  bottomArea: {
    paddingHorizontal: spacing.xxxl,
    gap: spacing.xxl,
    alignItems: 'center',
  },
  startButtonWrapper: {
    width: '100%',
    minHeight: 52,
  },
  startButton: {
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    ...typography.button,
  },
});
