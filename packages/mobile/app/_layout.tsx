import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../store/authStore';
import { ToastContainer } from '../components/shared/Toast';
import { TurnBanner } from '../components/shared/TurnBanner';
import { ConfirmDialogContainer } from '../components/ui/ConfirmDialog';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { NetworkStatusBar } from '../components/shared/NetworkStatusBar';
import { ThemeProvider, useThemeContext } from '../contexts/ThemeContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useDeepLinking } from '../hooks/useDeepLinking';
import { useNotifications } from '../hooks/useNotifications';
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
  const { isAuthenticated, isGuest } = useAuthStore();
  const { hasCompletedOnboarding } = useOnboardingStore();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const router = useRouter();
  const { isDark, colors } = useThemeContext();
  const { isConnected, isSocketConnected } = useNetworkStatus();
  const isNavigatingRef = useRef(false);
  useDeepLinking();
  useNotifications();

  // Gating redirect logic
  useEffect(() => {
    if (!isReady) return;
    if (isNavigatingRef.current) return;

    const seg = segmentsRef.current as readonly string[];
    const inAuthGroup = seg[0] === '(auth)';
    const inOnboarding = seg[0] === 'onboarding';
    const inGuestStatus = seg[0] === 'guest-status';
    // The read-only viewing board (현황 보드) is open to participants, including
    // guests — don't bounce a guest away from /session/[id]/board.
    const inViewBoard = seg[0] === 'session' && seg[2] === 'board';

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
    } else if (isGuest) {
      // Guests get a dedicated minimal status screen — never the member tabs.
      // Allow them to remain on guest-status (and on the (auth)/guest screen
      // momentarily during the check-in handoff before state propagates), and
      // to open the read-only viewing board for the live game status.
      if (!inGuestStatus && !inViewBoard) {
        isNavigatingRef.current = true;
        router.replace('/guest-status');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    } else {
      // Logged-in member -> club-centric home. Facility is no longer a gate;
      // selecting a facility is an optional context handled inside the app.
      // (facility-select remains reachable from settings/operator flows.)
      // A member should never sit on the guest-only status screen.
      if (inAuthGroup || inGuestStatus) {
        isNavigatingRef.current = true;
        router.replace('/(tabs)');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    }
  }, [isReady, isAuthenticated, isGuest, hasCompletedOnboarding]);

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
          <Stack.Screen name="guest-status" options={transitions.fadeScale} />
          <Stack.Screen name="facility-select" />
          <Stack.Screen name="notifications" options={transitions.modalSlideUp} />
          <Stack.Screen name="admin/index" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/session" options={transitions.slideFromRight} />
          <Stack.Screen name="checkin-modal" options={transitions.modalSlideUp} />
          <Stack.Screen name="session/[id]/operate" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/board" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/summary" options={transitions.slideFromRight} />
          <Stack.Screen name="change-password" options={transitions.slideFromRight} />
        </Stack>
        <ToastContainer />
        <TurnBanner />
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
