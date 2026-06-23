import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import {
  AuthRequest,
  ResponseType,
  makeRedirectUri,
  type AuthSessionResult,
} from 'expo-auth-session';

/**
 * Kakao OAuth — authorization-code step ONLY (secure, server-side exchange).
 *
 * The Kakao app is SHARED with a sibling service, so its client_secret must
 * never ship in this bundle. Therefore the client runs ONLY Kakao's authorize
 * step to obtain an authorization `code`; it does NOT call exchangeCodeAsync and
 * never touches the secret. The `code` (plus the exact `redirectUri` used to
 * obtain it) is handed to our backend, which exchanges it for a Kakao token.
 *
 * The whole flow is GATED on a configured Kakao REST key. When the key is absent
 * or still the "REPLACE_WITH_KAKAO_KEY" placeholder (preview builds without real
 * keys), `getKakaoAuthCode` returns null WITHOUT touching any OAuth API — so
 * nothing crashes and the caller can show a friendly "키 필요" message. Only once
 * a real key exists do we actually run OAuth.
 *
 * The user must:
 *   1. set EXPO_PUBLIC_KAKAO_REST_KEY (Kakao REST app key) — used here as the
 *      OAuth client_id (safe to ship; only the SECRET is private), and
 *   2. register the redirect URI that `makeRedirectUri()` returns (see below)
 *      in the Kakao developer console. On web this is the served origin
 *      (e.g. http://localhost:8081 in dev); on native it's `badminton://`.
 */

const KAKAO_KEY_PLACEHOLDER = 'REPLACE_WITH_KAKAO_KEY';

const KAKAO_DISCOVERY = {
  authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize',
  tokenEndpoint: 'https://kauth.kakao.com/oauth/token',
};

/** The configured Kakao REST key, or null when not (yet) configured. */
function getKakaoKey(): string | null {
  const key = Constants.expoConfig?.extra?.kakaoRestKey as string | undefined;
  if (!key || key === KAKAO_KEY_PLACEHOLDER) return null;
  return key;
}

/** True when a real (non-placeholder) Kakao key is configured. */
export function isKakaoConfigured(): boolean {
  return getKakaoKey() !== null;
}

// Required on web so the popup window can deliver the auth result back.
WebBrowser.maybeCompleteAuthSession();

/**
 * Runs Kakao's authorize step and resolves to the authorization `code` plus the
 * EXACT `redirectUri` used to obtain it (the backend must reuse the same
 * redirectUri for the token exchange — Kakao validates the match). Resolves to
 * null when:
 *  - no real Kakao key is configured (placeholder) — caller shows "키 필요", or
 *  - the user cancelled / dismissed the auth prompt, or
 *  - the flow otherwise failed.
 *
 * Web-safe: uses expo-web-browser under the hood via expo-auth-session.
 */
export async function getKakaoAuthCode(): Promise<{ code: string; redirectUri: string } | null> {
  const clientId = getKakaoKey();
  // Not configured → never attempt OAuth; let the caller show the friendly
  // "카카오 로그인 설정이 준비 중이에요 (키 필요)" message.
  if (!clientId) return null;

  // Compute the redirect URI ONCE. On web this is the served origin (e.g.
  // http://localhost:8081); on native it's the `badminton://` scheme. The SAME
  // value is returned to the caller so the backend exchange uses an identical
  // redirect_uri.
  const redirectUri = makeRedirectUri({ scheme: 'badminton' });

  const request = new AuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.Code,
    // No forced scope: requesting an unconfigured consent item (e.g.
    // profile_nickname) on the shared Kakao app triggers KOE205 at the consent
    // step. We only need the kakao id to identify/create the user; the backend
    // falls back to '카카오회원' when no nickname is returned. To request the
    // nickname later, enable the 닉네임(profile_nickname) consent item in the
    // Kakao console (선택 동의) and set scopes: ['profile_nickname'] here.
    scopes: [],
    usePKCE: false,
  });

  let result: AuthSessionResult;
  try {
    result = await request.promptAsync(KAKAO_DISCOVERY);
  } catch {
    return null;
  }

  if (result.type !== 'success' || !result.params.code) {
    // 'cancel' / 'dismiss' / 'error' — treat all as "no code".
    return null;
  }

  // No client-side token exchange (no client_secret here). Hand the raw code +
  // the redirectUri to the backend.
  return { code: result.params.code, redirectUri };
}

// ───────────────────────────────────────────────────────────────────────────
// WEB full-page redirect flow
//
// Mobile browsers (iOS Safari etc.) block/break the popup window that
// expo-auth-session's promptAsync opens (window.open), which is why Kakao login
// "flickers then fails" on mobile web. On WEB we therefore drive OAuth with a
// FULL-PAGE redirect: tap → navigate the whole tab to Kakao's authorize URL →
// Kakao redirects back to our origin with ?code&state → we detect it on startup
// and finish login. NATIVE keeps using getKakaoAuthCode() (expo-auth-session).
// ───────────────────────────────────────────────────────────────────────────

// sessionStorage key holding the CSRF `state` (+ a timestamp) across the
// full-page redirect. sessionStorage survives the redirect within the same tab
// and is cleared when the tab closes — exactly the lifetime we want.
const KAKAO_WEB_STATE_KEY = 'kakao_oauth_state';

/** Generate a random, URL-safe state token for CSRF protection. */
function generateState(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Starts the WEB Kakao login via a FULL-PAGE redirect (no popup). Persists a
 * fresh `state` to sessionStorage, then navigates the whole tab to Kakao's
 * authorize endpoint. The redirect_uri is the bare origin (NO trailing slash),
 * identical to what `makeRedirectUri` produces on web today and what the server
 * reuses at the token exchange — Kakao validates an exact match.
 *
 * Throws KakaoNotConfiguredError-able null signal by returning `false` when no
 * real key is configured so the caller can show the friendly "키 필요" notice.
 * Returns `true` once navigation has been kicked off (the page is leaving).
 */
export function startKakaoWebLogin(): boolean {
  const clientId = getKakaoKey();
  if (!clientId) return false;

  const origin = window.location.origin;
  const state = generateState();

  try {
    sessionStorage.setItem(KAKAO_WEB_STATE_KEY, JSON.stringify({ state, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable (private mode quirks) — proceed anyway; the
    // callback will simply skip strict state verification if it can't read back.
  }

  const authorizeUrl =
    'https://kauth.kakao.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(origin)}` +
    '&response_type=code' +
    `&state=${encodeURIComponent(state)}`;

  // Full-page navigation — replaces the popup. Mobile-browser safe.
  window.location.assign(authorizeUrl);
  return true;
}

/** Result of inspecting the current URL for a Kakao OAuth return. */
export type KakaoWebCallback =
  | { kind: 'none' }
  | { kind: 'success'; code: string; redirectUri: string }
  | { kind: 'state_mismatch' }
  | { kind: 'error'; message: string };

/**
 * Inspects the current web URL for a Kakao OAuth return and, on a valid
 * `?code&state`, returns the `{code, redirectUri}` to finish login. ALSO strips
 * the OAuth params from the URL (history.replaceState) so a refresh doesn't
 * re-run the flow and the gate sees a clean URL, and clears the stored state.
 *
 * - success: `code` present and `state` matches the stored one.
 * - state_mismatch: `code` present but `state` missing/wrong → ignored (no login).
 * - error: `?error`/`?error_description` present (user denied / Kakao error).
 * - none: nothing OAuth-related in the URL.
 *
 * Web-only; on native (or when there's no window) returns { kind: 'none' }.
 */
export function consumeKakaoWebCallback(): KakaoWebCallback {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { kind: 'none' };

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  // Nothing OAuth-related → leave the URL untouched.
  if (!code && !error) return { kind: 'none' };

  // Read + clear the stored state regardless of outcome (single-use).
  let storedState: string | null = null;
  try {
    const raw = sessionStorage.getItem(KAKAO_WEB_STATE_KEY);
    if (raw) storedState = (JSON.parse(raw) as { state?: string }).state ?? null;
    sessionStorage.removeItem(KAKAO_WEB_STATE_KEY);
  } catch {
    /* sessionStorage unreadable — treat as no stored state. */
  }

  // Strip ?code/state/error/... from the URL so a refresh can't replay it and
  // the gate sees a clean path. Keep the pathname + hash, drop the query.
  cleanOAuthUrl();

  if (error) {
    return {
      kind: 'error',
      message: errorDescription || error || '카카오 로그인이 취소되었어요',
    };
  }

  // code present — verify state. A missing/mismatched state means this isn't a
  // request we started (CSRF / stale tab) → ignore, do NOT log in. (`code` is
  // guaranteed truthy here: no `error` and the early guard handled neither.)
  if (!code || !state || !storedState || state !== storedState) {
    return { kind: 'state_mismatch' };
  }

  // A fresh, verified code → log in the returned Kakao identity. redirectUri
  // MUST equal what we sent at authorize (the bare origin) so the server's
  // exchange matches.
  return { kind: 'success', code, redirectUri: window.location.origin };
}

/** Remove the query string (OAuth params) from the URL without reloading. */
function cleanOAuthUrl(): void {
  try {
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch {
    /* history API unavailable — best effort. */
  }
}
