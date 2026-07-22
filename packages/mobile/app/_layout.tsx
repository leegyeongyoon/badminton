import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../store/authStore';
import { usePendingJoinStore } from '../store/pendingJoinStore';
import { usePendingAttendStore } from '../store/pendingAttendStore';
import { useClubStore } from '../store/clubStore';
import { clubSessionApi } from '../services/clubSession';
import { showError, showSuccess } from '../utils/feedback';
import { ToastContainer } from '../components/shared/Toast';
import { TurnBanner } from '../components/shared/TurnBanner';
import { ConfirmDialogContainer } from '../components/ui/ConfirmDialog';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { NetworkStatusBar } from '../components/shared/NetworkStatusBar';
import { AppInstallBanner } from '../components/shared/AppInstallBanner';
import { ThemeProvider, useThemeContext } from '../contexts/ThemeContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useDeepLinking } from '../hooks/useDeepLinking';
import { useKakaoWebCallback } from '../hooks/useKakaoWebCallback';
import { useGoogleWebCallback } from '../hooks/useGoogleWebCallback';
import { useNotifications } from '../hooks/useNotifications';
import { useSocketToast } from '../hooks/useSocketToast';
import { useSocket, useUserRoom } from '../hooks/useSocket';
import { useOnboardingStore } from '../store/onboardingStore';
import { useAppInit } from '../hooks/useAppInit';
import { transitions } from '../utils/transitions';
import { lightColors } from '../constants/theme';
import * as Sentry from '@sentry/react-native';

// 크래시/에러 모니터링 — 네이티브(안드/iOS)에서만 켠다. 웹(운영판 주 사용)은
// @sentry/react-native가 완전 지원이 아니라 건드리지 않아 안정성 우선. DSN은
// 공개값이라 임베드 안전. __DEV__(로컬)에선 꺼서 노이즈 방지 → 릴리스에서만 수집.
if (Platform.OS !== 'web') {
  Sentry.init({
    dsn: 'https://2c56521b4279ec7ea9a644510665e40a@o4511765184708608.ingest.us.sentry.io/4511765222129664',
    enabled: !__DEV__,
  });
}

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

// Brand-new Kakao users land with this placeholder name and no profile — the
// gate routes them through /profile-setup before the home tabs.
const PLACEHOLDER_NAME = '카카오회원';

function RootLayoutInner() {
  const { isReady } = useAppInit();
  const { isAuthenticated, isGuest, user } = useAuthStore();
  const { hasCompletedOnboarding } = useOnboardingStore();
  const { pendingInviteCode, clearPendingInviteCode } = usePendingJoinStore();
  const { pendingAttendSessionId, clearPendingAttendSessionId } = usePendingAttendStore();
  const joinInFlightRef = useRef(false);
  const attendInFlightRef = useRef(false);
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const router = useRouter();
  const { isDark, colors } = useThemeContext();
  const { isConnected, isSocketConnected } = useNetworkStatus();
  const isNavigatingRef = useRef(false);
  useDeepLinking();
  // WEB-only: detect the Google full-page-redirect return (?code&state) on
  // startup and finish login. Mounted BEFORE useKakaoWebCallback so on a Google
  // return it resolves + cleans the URL first, and on a Kakao return it no-ops
  // without touching the URL (each checks ITS OWN stored state). Native no-op.
  useGoogleWebCallback();
  // WEB-only: detect the Kakao full-page-redirect return (?code&state) on
  // startup and finish login. Runs independently of the gate; native no-op.
  useKakaoWebCallback();
  useNotifications();
  // Establish the websocket app-wide on load (before any screen mounts), so
  // real-time sync + the network status are accurate everywhere.
  useSocket();
  // Your-turn banner + real-time toasts must work on ALL screens (incl. stack
  // screens outside the tabs like the operator board), so mount the listener
  // + the user-room join ONCE here at the root rather than in (tabs)/_layout.
  useUserRoom(user?.id);
  useSocketToast();

  // Gating redirect logic
  useEffect(() => {
    if (!isReady) return;
    if (isNavigatingRef.current) return;

    const seg = segmentsRef.current as readonly string[];
    const inAuthGroup = seg[0] === '(auth)';
    const inOnboarding = seg[0] === 'onboarding';
    const inGuestStatus = seg[0] === 'guest-status';
    const inProfileSetup = seg[0] === 'profile-setup';
    // 운영자 회원가입 승인 대기 화면 — PENDING/REJECTED 계정을 여기 가둔다.
    const inOperatorPending = seg[0] === 'operator-pending';
    // /join captures the pending invite code itself; never bounce away from it.
    const inJoin = seg[0] === 'join';
    // /attend captures the pending 정모 출석 session id itself; never bounce away.
    const inAttend = seg[0] === 'attend';
    // The read-only viewing board (현황 보드) and the monitoring display
    // (모니터 뷰) are open to participants, including guests — don't bounce a
    // guest away from /session/[id]/board or /session/[id]/monitor.
    const inViewBoard = seg[0] === 'session' && (seg[2] === 'board' || seg[2] === 'monitor');
    // 개인정보처리방침은 공개 페이지(App Store 심사자가 로그인 없이 열어야 함) —
    // 온보딩/로그인/게스트 게이트 모두에서 예외로 둔다.
    // 로그인 없이 볼 수 있는 공개 페이지(개인정보처리방침·계정삭제 안내). 아래 게이트
    // 조건들이 모두 !inPrivacy 로 예외 처리하므로 여기에 추가하면 한 번에 허용된다.
    const inPrivacy = seg[0] === 'privacy' || seg[0] === 'delete-account';

    // Onboarding gate: first-time users see the onboarding flow
    if (hasCompletedOnboarding === false && !inOnboarding && !inPrivacy) {
      isNavigatingRef.current = true;
      router.replace('/onboarding');
      setTimeout(() => { isNavigatingRef.current = false; }, 100);
      return;
    }

    if (!isAuthenticated) {
      // Not logged in -> auth screens (개인정보처리방침은 공개라 예외)
      if (!inAuthGroup && !inPrivacy) {
        isNavigatingRef.current = true;
        router.replace('/(auth)/login');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    } else if (isGuest) {
      // Guests get a dedicated minimal status screen — never the member tabs.
      // Allow them to remain on guest-status (and on the (auth)/guest screen
      // momentarily during the check-in handoff before state propagates), and
      // to open the read-only viewing board for the live game status.
      if (!inGuestStatus && !inViewBoard && !inPrivacy) {
        isNavigatingRef.current = true;
        router.replace('/guest-status');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    } else {
      // 0) 운영자 회원가입 승인 대기(PENDING)/거절(REJECTED) 계정 → 승인 대기 화면에
      //    가둔다. 프로필 온보딩·홈보다 먼저(급수/성별 강제 흐름을 우회). 최고관리자
      //    승인 시 accountStatus=ACTIVE 로 바뀌어 이 게이트를 통과하고 아래 홈 흐름으로.
      if (user?.accountStatus === 'PENDING' || user?.accountStatus === 'REJECTED') {
        if (!inOperatorPending && !inPrivacy) {
          isNavigatingRef.current = true;
          router.replace('/operator-pending');
          setTimeout(() => { isNavigatingRef.current = false; }, 100);
        }
        return;
      }

      // Logged-in member. ORDER: profile-setup (if new/placeholder/no 급수/no 성별) →
      // consume pendingJoin → home/club.
      // A returning user whose profile has NO 급수 (skillLevel) OR NO 성별 (gender)
      // is also routed to profile-setup so both are set exactly once. 카카오 로그인은
      // 성별을 주지 않으므로(닉네임만) 성별 없는 기존 회원도 한 번 프롬프트된다.
      // 성별은 ♂/♀ 마커 + 혼복/남복 매칭에 필수이므로 게이트가 강제한다.
      // 최고관리자(SUPER_ADMIN)는 플레이어가 아니므로 급수/성별/프로필 온보딩을 건너뛴다.
      const needsProfile =
        user?.role !== 'SUPER_ADMIN' &&
        (!user || user.name === PLACEHOLDER_NAME || !user.name?.trim() || !user.skillLevel || !user.gender);

      // 1) New Kakao user (placeholder name) OR a user missing 급수/성별 → finish profile first.
      if (needsProfile) {
        if (!inProfileSetup) {
          isNavigatingRef.current = true;
          router.replace('/profile-setup');
          setTimeout(() => { isNavigatingRef.current = false; }, 100);
        }
        return;
      }

      // 2) Profile complete + a pending 정모 출석 (출석 QR) → unconditionally
      // check in (NO geofence — the QR at the venue is the presence proof), then
      // land directly on the live 현황 보드. Handled BEFORE pendingInvite: a 출석
      // QR is the more immediate intent (the user is physically at the 정모).
      if (pendingAttendSessionId && !attendInFlightRef.current) {
        attendInFlightRef.current = true;
        isNavigatingRef.current = true;
        const sessionId = pendingAttendSessionId;
        (async () => {
          try {
            await clubSessionApi.attend(sessionId);
            await clearPendingAttendSessionId();
            router.replace(`/session/${sessionId}/board`);
          } catch (err: any) {
            // 정모 ended / not active / not found → toast + go home.
            await clearPendingAttendSessionId();
            showError(err?.response?.data?.error || '출석할 수 없는 정모예요');
            router.replace('/(tabs)');
          } finally {
            setTimeout(() => {
              isNavigatingRef.current = false;
              attendInFlightRef.current = false;
            }, 100);
          }
        })();
        return;
      }

      // 3) Profile complete + a pending club invite → auto-join, then enter it.
      if (pendingInviteCode && !joinInFlightRef.current) {
        joinInFlightRef.current = true;
        isNavigatingRef.current = true;
        const code = pendingInviteCode;
        (async () => {
          try {
            const clubId = await useClubStore.getState().joinClub(code);
            await clearPendingInviteCode();
            showSuccess('모임에 참여했어요');
            router.replace(`/club/${clubId}`);
          } catch (err: any) {
            await clearPendingInviteCode();
            // Already a member is fine — try to land in that club; otherwise home.
            const status = err?.response?.status;
            if (status === 409) {
              // Already joined: navigate home (we don't have the id here).
              router.replace('/(tabs)');
            } else {
              showError(err?.response?.data?.error || '유효하지 않은 초대 코드');
              router.replace('/(tabs)');
            }
          } finally {
            setTimeout(() => {
              isNavigatingRef.current = false;
              joinInFlightRef.current = false;
            }, 100);
          }
        })();
        return;
      }

      // 4) Otherwise -> club-centric home. Bounce off auth/guest/onboarding/
      // profile-setup screens.
      // NOTE: do NOT bounce inJoin / inAttend here. Those transient screens set
      // their pending action (invite code / attend session) which steps 2-3 then
      // consume and navigate away. Bouncing them races the pending-set: the gate
      // runs once before the screen stores its pending → bounces to home →
      // isNavigatingRef blocks the re-run that would consume it → an ALREADY
      // logged-in user lands on home and the join/attend never runs.
      if (inAuthGroup || inGuestStatus || inProfileSetup) {
        isNavigatingRef.current = true;
        router.replace('/(tabs)');
        setTimeout(() => { isNavigatingRef.current = false; }, 100);
      }
    }
  }, [isReady, isAuthenticated, isGuest, hasCompletedOnboarding, user, pendingInviteCode, pendingAttendSessionId]);

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
          <Stack.Screen name="profile-setup" options={transitions.fadeScale} />
          <Stack.Screen name="join" options={transitions.fadeScale} />
          <Stack.Screen name="attend" options={transitions.fadeScale} />
          <Stack.Screen name="guest-status" options={transitions.fadeScale} />
          <Stack.Screen name="operator-pending" options={transitions.fadeScale} />
          <Stack.Screen name="privacy" options={transitions.slideFromRight} />
          <Stack.Screen name="delete-account" options={transitions.slideFromRight} />
          <Stack.Screen name="guide" options={transitions.slideFromRight} />
          <Stack.Screen name="facility-select" />
          <Stack.Screen name="notifications" options={transitions.modalSlideUp} />
          <Stack.Screen name="admin/index" options={transitions.slideFromRight} />
          <Stack.Screen name="admin/operator-requests" options={transitions.slideFromRight} />
          <Stack.Screen name="admin/clubs" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/session" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/qr" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/chat" options={transitions.slideFromRight} />
          <Stack.Screen name="club/[id]/manage" options={transitions.slideFromRight} />
          <Stack.Screen name="checkin-modal" options={transitions.modalSlideUp} />
          <Stack.Screen name="session/[id]/operate" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/qr" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/board" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/monitor" options={transitions.slideFromRight} />
          <Stack.Screen name="session/[id]/summary" options={transitions.slideFromRight} />
          <Stack.Screen name="change-password" options={transitions.slideFromRight} />
        </Stack>
        <ToastContainer />
        <TurnBanner />
        <ConfirmDialogContainer />
        <AppInstallBanner />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}

// Sentry.wrap: 렌더 트리 에러 경계 + 네이티브 크래시 연결. 웹은 감싸지 않는다(가드).
export default Platform.OS === 'web' ? RootLayout : Sentry.wrap(RootLayout);

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
