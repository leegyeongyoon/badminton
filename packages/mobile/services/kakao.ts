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
