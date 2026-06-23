import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { consumeKakaoWebCallback } from '../services/kakao';
import { useAuthStore } from '../store/authStore';
import { showError } from '../utils/feedback';

/**
 * WEB-only: finishes the Kakao full-page redirect login.
 *
 * After we navigate the whole tab to Kakao's authorize URL (see
 * `startKakaoWebLogin`), Kakao redirects back to our origin with `?code&state`.
 * On app startup this hook inspects the URL ONCE:
 *  - valid `?code&state` (state matches the one we stored) → call
 *    `kakaoLogin({ code, redirectUri })`; on success tokens are stored and the
 *    gate routes the now-authenticated user (consuming any pending QR
 *    attend/join context, which lives in storage and is left untouched).
 *  - state mismatch → ignored (no login), URL cleaned.
 *  - `?error` (user denied / Kakao error) → friendly toast, URL cleaned.
 *
 * `consumeKakaoWebCallback` strips the OAuth params from the URL
 * (history.replaceState) so a refresh can't replay it and the gate sees a clean
 * URL. A fresh code+state always logs in the RETURNED Kakao identity regardless
 * of prior auth state (so a logout → Kakao-login or admin↔kakao account switch
 * is honored).
 *
 * Native is a no-op (it keeps the expo-auth-session flow).
 */
export function useKakaoWebCallback(): void {
  // Guard against React StrictMode / double-invoke re-running the one-shot
  // callback consumption. The URL is also cleaned synchronously which is the
  // real safeguard, but this avoids a redundant second pass within one mount.
  const handledRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (handledRef.current) return;
    handledRef.current = true;

    const result = consumeKakaoWebCallback();
    if (result.kind === 'none') return;

    if (result.kind === 'error') {
      showError(result.message || '카카오 로그인에 실패했어요');
      return;
    }

    if (result.kind === 'state_mismatch') {
      // Not a request we started (stale tab / CSRF) — silently ignore.
      return;
    }

    // result.kind === 'success' — finish login with the obtained code.
    (async () => {
      try {
        await useAuthStore.getState().kakaoLogin({
          code: result.code,
          redirectUri: result.redirectUri,
        });
        // Authenticated — the root gate routes from here (incl. pending
        // attend/join QR context already persisted in storage).
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || '카카오 로그인에 실패했어요';
        showError(msg);
      }
    })();
  }, []);
}
