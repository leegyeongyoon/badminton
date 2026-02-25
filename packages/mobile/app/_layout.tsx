import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../store/authStore';
import { useFacilityStore } from '../store/facilityStore';
import { ToastContainer } from '../components/shared/Toast';
import { ConfirmDialogContainer } from '../components/ui/ConfirmDialog';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { NetworkStatusBar } from '../components/shared/NetworkStatusBar';
import { ThemeProvider, useThemeContext } from '../contexts/ThemeContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useDeepLinking } from '../hooks/useDeepLinking';
import { useOnboardingStore } from '../store/onboardingStore';
import { useAppInit } from '../hooks/useAppInit';
import { transitions } from '../utils/transitions';
import { lightColors } from '../constants/theme';

// Web-only patches (must run before any component renders)
if (Platform.OS === 'web') {
  // Inject Pretendard font CSS
  if (typeof document !== 'undefined') {
    const linkEl = document.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css';
    document.head.appendChild(linkEl);
  }
}

function RootLayoutInner() {
  const { isReady } = useAppInit();
  const { isAuthenticated } = useAuthStore();
  const { selectedFacility } = useFacilityStore();
  const { hasCompletedOnboarding } = useOnboardingStore();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const router = useRouter();
  const { isDark, colors } = useThemeContext();
  const { isConnected, isSocketConnected } = useNetworkStatus();
  const isNavigatingRef = useRef(false);
  useDeepLinking();

  // Gating redirect logic
  useEffect(() => {
    if (!isReady) return;
    if (isNavigatingRef.current) return;

    const seg = segmentsRef.current;
    const inAuthGroup = seg[0] === '(auth)';
    const inFacilitySelect = seg[0] === 'facility-select';
    const inOnboarding = seg[0] === 'onboarding';

    // Onboarding gate: first-time users see the onboarding flow
    if (hasCompletedOnboarding === false && !inOnboarding) {
      isNavigatingRef.current = true;
      router.replace('/onboarding');
      setTimeout(() => { isNavigatingRef.current = false; }, 100);
      return;
    }

    if (!isAuthenticated) {
      // Not logged in -> auth screens
      if (!inAuthGroup) {
        isNavigatingRef.current = true;
        router.replace('/(auth)/login');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    } else if (!selectedFacility) {
      // Logged in but no facility -> facility select
      if (!inFacilitySelect) {
        isNavigatingRef.current = true;
        router.replace('/facility-select');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    } else {
      // Logged in + facility selected -> main app
      if (inAuthGroup || inFacilitySelect) {
        isNavigatingRef.current = true;
        router.replace('/(tabs)');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    }
  }, [isReady, isAuthenticated, selectedFacility, hasCompletedOnboarding]);

  if (!isReady) {
    return (
      <View style={[loadingStyles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={rootStyles.flex}>
      <ErrorBoundary>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <NetworkStatusBar
          isConnected={isConnected}
          isReconnecting={isConnected && !isSocketConnected}
        />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="onboarding" options={transitions.fadeScale} />
          <Stack.Screen name="(auth)" options={transitions.fadeScale} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="facility-select" />
          <Stack.Screen name="notifications" options={transitions.modalSlideUp} />
          <Stack.Screen name="admin/index" options={transitions.slideFromRight} />
          <Stack.Screen name="admin/rotation" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/session" options={transitions.slideFromRight} />
          <Stack.Screen name="court/[id]" options={transitions.slideFromRight} />
          <Stack.Screen name="display" />
          <Stack.Screen name="facility/[id]" options={transitions.slideFromRight} />
          <Stack.Screen name="checkin-modal" options={transitions.modalSlideUp} />
          <Stack.Screen name="recruitment/create" options={transitions.modalSlideUp} />
          <Stack.Screen name="game-board" options={transitions.slideFromRight} />
          <Stack.Screen name="change-password" options={transitions.slideFromRight} />
        </Stack>
        <ToastContainer />
        <ConfirmDialogContainer />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

const rootStyles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: lightColors.background,
  },
});
