import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Google OAuth — authorization-code step ONLY (secure, server-side exchange).
 *
 * Mirrors services/kakao.ts. The Google client_secret must never ship in this
 * bundle, so the client runs ONLY Google's authorize step (full-page redirect on
 * web) to obtain an authorization `code`; it never touches the secret. The
 * `code` (plus the exact `redirectUri` used to obtain it) is handed to our
 * backend, which exchanges it for a Google token.
 *
 * The whole flow is GATED on a configured Google client id. When the id is
 * absent or still the "REPLACE_WITH_GOOGLE_CLIENT_ID" placeholder (preview
 * builds without real keys), nothing happens — so the caller can show a friendly
 * "키 필요" message. Only once a real id exists do we actually run OAuth.
 *
 * The user must:
 *   1. set EXPO_PUBLIC_GOOGLE_CLIENT_ID (Google OAuth client id) — used here as
 *      the OAuth client_id (safe to ship; only the SECRET is private), and
 *   2. register the redirect URI (the served web origin, e.g.
 *      http://localhost:8081 in dev / https://badmintoncourt.store in prod) in
 *      the Google Cloud console.
 */

const GOOGLE_CLIENT_ID_PLACEHOLDER = 'REPLACE_WITH_GOOGLE_CLIENT_ID';

/** The configured Google client id, or null when not (yet) configured. */
function getGoogleClientId(): string | null {
  const id = Constants.expoConfig?.extra?.googleClientId as string | undefined;
  if (!id || id === GOOGLE_CLIENT_ID_PLACEHOLDER) return null;
  return id;
}

/** True when a real (non-placeholder) Google client id is configured. */
export function isGoogleConfigured(): boolean {
  return getGoogleClientId() !== null;
}

// ───────────────────────────────────────────────────────────────────────────
// WEB full-page redirect flow
//
// Mirrors the Kakao web flow: tap → navigate the whole tab to Google's authorize
// URL → Google redirects back to our origin with ?code&state → we detect it on
// startup and finish login. (Native Google login is not wired here — the button
// is web-only, like the Kakao web path.)
// ───────────────────────────────────────────────────────────────────────────

// sessionStorage key holding the CSRF `state` (+ a timestamp) across the
// full-page redirect. DISTINCT from Kakao's key so the two flows never collide.
const GOOGLE_WEB_STATE_KEY = 'google_oauth_state';
// sessionStorage key holding the FLOW MODE ('login' | 'link') across the
// redirect, so the callback knows whether to LOG IN or LINK the returned Google
// identity. Distinct from Kakao's mode key.
const GOOGLE_WEB_MODE_KEY = 'google_oauth_mode';

/** Whether the OAuth round-trip is a normal login or a (authenticated) link. */
export type OAuthMode = 'login' | 'link';

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
 * Starts the WEB Google login via a FULL-PAGE redirect (no popup). Persists a
 * fresh `state` to sessionStorage under the Google-specific key, then navigates
 * the whole tab to Google's authorize endpoint. The redirect_uri is the bare
 * origin (NO trailing slash), identical to what the server reuses at the token
 * exchange — Google validates an exact match.
 *
 * Returns `false` when no real client id is configured so the caller can show
 * the friendly "키 필요" notice. Returns `true` once navigation has been kicked
 * off (the page is leaving).
 */
export function startGoogleWebLogin(mode: OAuthMode = 'login'): boolean {
  const clientId = getGoogleClientId();
  if (!clientId) return false;

  const origin = window.location.origin;
  const state = generateState();

  try {
    sessionStorage.setItem(GOOGLE_WEB_STATE_KEY, JSON.stringify({ state, ts: Date.now() }));
    // Remember whether this round-trip is a LOGIN or a LINK so the callback can
    // branch. Default 'login' keeps the existing flow untouched.
    sessionStorage.setItem(GOOGLE_WEB_MODE_KEY, mode);
  } catch {
    // sessionStorage unavailable (private mode quirks) — proceed anyway; the
    // callback will simply skip strict state verification if it can't read back.
  }

  const authorizeUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(origin)}` +
    '&response_type=code' +
    '&scope=openid%20email%20profile' +
    `&state=${encodeURIComponent(state)}` +
    '&access_type=online' +
    '&prompt=select_account';

  // Full-page navigation — replaces the popup. Mobile-browser safe.
  window.location.assign(authorizeUrl);
  return true;
}

/** Result of inspecting the current URL for a Google OAuth return. `mode`
 *  ('login' | 'link') tells the callback whether to log in or LINK the returned
 *  identity (carried across the redirect via sessionStorage). */
export type GoogleWebCallback =
  | { kind: 'none' }
  | { kind: 'success'; code: string; redirectUri: string; mode: OAuthMode }
  | { kind: 'state_mismatch' }
  | { kind: 'error'; message: string; mode: OAuthMode };

/**
 * Inspects the current web URL for a Google OAuth return and, on a valid
 * `?code&state`, returns the `{code, redirectUri}` to finish login. Mirrors
 * consumeKakaoWebCallback but checks the Google-specific state key, so the two
 * callbacks never fire on the same return — each only proceeds if ITS OWN stored
 * state matches the returned `state`.
 *
 * ALSO strips the OAuth params from the URL (history.replaceState) so a refresh
 * doesn't re-run the flow, and clears the stored state.
 *
 * - success: `code` present and `state` matches the stored Google state.
 * - state_mismatch: `code` present but `state` missing/wrong (e.g. it was a
 *   Kakao return, or CSRF/stale tab) → ignored (no login), URL left for the
 *   matching consumer.
 * - error: `?error`/`?error_description` present (user denied / Google error).
 * - none: nothing OAuth-related in the URL.
 *
 * Web-only; on native (or when there's no window) returns { kind: 'none' }.
 *
 * IMPORTANT: this does NOT strip the URL on a state_mismatch — that lets the
 * Kakao consumer (which checks the kakao state) still see the params on a Kakao
 * return. It only cleans the URL on success/error (a return this consumer owns).
 */
export function consumeGoogleWebCallback(): GoogleWebCallback {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { kind: 'none' };

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  // Nothing OAuth-related → leave the URL untouched.
  if (!code && !error) return { kind: 'none' };

  // Read the stored Google state. Do NOT clear it yet — only consume (clear the
  // state + strip the URL) once we've confirmed this return is OURS, i.e. WE
  // have a pending Google state AND it matches the returned one. A return that
  // isn't ours (no google state, or mismatched state — e.g. a Kakao return) must
  // be left completely untouched so the Kakao consumer can still handle it.
  let storedState: string | null = null;
  try {
    const raw = sessionStorage.getItem(GOOGLE_WEB_STATE_KEY);
    if (raw) storedState = (JSON.parse(raw) as { state?: string }).state ?? null;
  } catch {
    /* sessionStorage unreadable — treat as no stored state. */
  }

  // No pending Google login (no stored state) → this return belongs to the other
  // (Kakao) flow. Ignore it entirely; leave the URL + params for its consumer.
  if (!storedState) {
    return { kind: 'state_mismatch' };
  }

  // Read the flow mode ('login' default) BEFORE clearing storage, so the caller
  // knows whether to log in or LINK the returned identity.
  let mode: OAuthMode = 'login';
  try {
    if (sessionStorage.getItem(GOOGLE_WEB_MODE_KEY) === 'link') mode = 'link';
  } catch {
    /* unreadable — default to 'login'. */
  }

  // We DO have a pending Google login. This return is now ours to resolve — clear
  // our state + mode and strip the OAuth params from the URL.
  try {
    sessionStorage.removeItem(GOOGLE_WEB_STATE_KEY);
    sessionStorage.removeItem(GOOGLE_WEB_MODE_KEY);
  } catch {
    /* noop */
  }
  cleanOAuthUrl();

  if (error) {
    return {
      kind: 'error',
      message: errorDescription || error || '구글 로그인이 취소되었어요',
      mode,
    };
  }

  // code present — verify state matches. A mismatch means this isn't the request
  // we started (CSRF / stale tab) → ignore, do NOT log in.
  if (!code || !state || state !== storedState) {
    return { kind: 'state_mismatch' };
  }

  // A fresh, verified code → log in OR link the returned Google identity.
  // redirectUri MUST equal what we sent at authorize (the bare origin) so the
  // server's exchange matches.
  return { kind: 'success', code, redirectUri: window.location.origin, mode };
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
