import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { consumeGoogleWebCallback } from '../services/google';
import { useAuthStore } from '../store/authStore';
import { showError, showSuccess } from '../utils/feedback';

/**
 * WEB-only: finishes the Google full-page redirect login. Mirrors
 * useKakaoWebCallback.
 *
 * After we navigate the whole tab to Google's authorize URL (see
 * `startGoogleWebLogin`), Google redirects back to our origin with `?code&state`.
 * On app startup this hook inspects the URL ONCE:
 *  - valid `?code&state` (state matches the Google state we stored) → call
 *    `googleLogin({ code, redirectUri })`; on success tokens are stored and the
 *    gate routes the now-authenticated user.
 *  - state mismatch (incl. a Kakao return, which has no Google state) → ignored
 *    (no login), URL left untouched for the Kakao consumer.
 *  - `?error` (user denied / Google error) → friendly toast, URL cleaned.
 *
 * IMPORTANT (no double-trigger): this hook only consumes a return when a pending
 * Google `state` exists in sessionStorage; otherwise it leaves the URL untouched.
 * It is mounted BEFORE useKakaoWebCallback so on a Google return it resolves and
 * cleans the URL first (Kakao then sees a clean URL → no-op), and on a Kakao
 * return it no-ops without touching the URL (Kakao then resolves it). The two
 * never both log in.
 *
 * Native is a no-op.
 */
export function useGoogleWebCallback(): void {
  // Guard against React StrictMode / double-invoke re-running the one-shot
  // callback consumption within a single mount.
  const handledRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (handledRef.current) return;
    handledRef.current = true;

    const result = consumeGoogleWebCallback();
    if (result.kind === 'none') return;

    if (result.kind === 'error') {
      // mode==='link' → the user was attaching Google from 내 정보; show a link-
      // flavored message. Otherwise the normal login error.
      showError(
        result.message ||
          (result.mode === 'link' ? '구글 연동에 실패했어요' : '구글 로그인에 실패했어요'),
      );
      return;
    }

    if (result.kind === 'state_mismatch') {
      // Not a Google request we started (a Kakao return / stale tab / CSRF) —
      // silently ignore and leave the URL for the matching consumer.
      return;
    }

    // result.kind === 'success' — branch on the flow mode.
    if (result.mode === 'link') {
      // LINK: the user's token persisted across the redirect → attach Google to
      // the current account, refresh the user (linkedProviders updates), toast,
      // and return to the profile (내 정보) screen.
      (async () => {
        try {
          await useAuthStore.getState().linkGoogle({
            code: result.code,
            redirectUri: result.redirectUri,
          });
          showSuccess('구글 연동 완료');
          router.replace('/(tabs)/profile');
        } catch (err: any) {
          // 409 (이미 다른 계정에 연동…) / 400 / auth error → surface the server message.
          const msg = err?.response?.data?.error || err?.message || '구글 연동에 실패했어요';
          showError(msg);
        }
      })();
      return;
    }

    // mode==='login' — finish login with the obtained code (existing behavior).
    (async () => {
      try {
        await useAuthStore.getState().googleLogin({
          code: result.code,
          redirectUri: result.redirectUri,
        });
        // Authenticated — the root gate routes from here.
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || '구글 로그인에 실패했어요';
        showError(msg);
      }
    })();
  }, []);
}
