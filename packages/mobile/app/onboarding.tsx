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
    title: 'QR로 간편하게 체크인',
    description: '정모 장소에 도착하면 QR 코드를 찍어\n바로 출석 체크! 위치 인증까지 한 번에.',
    illustration: <CourtIllustration />,
  },
  {
    title: '운영자가 게임을 짜줘요',
    description: '출석한 사람들로 운영자가 게임을 편성하고\n코트에 배정해요. 편하게 기다리기만 하세요.',
    illustration: <RegistrationIllustration />,
  },
  {
    title: '내 차례를 알림으로',
    description: '내 게임이 잡히면 알림이 오고,\n현황 보드로 실시간 순서를 확인할 수 있어요.',
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
