import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';
import { authApi } from '../services/auth';
import { onAuthExpired } from '../services/api';
import { disconnectSocket } from '../hooks/useSocket';
import { getKakaoAuthCode } from '../services/kakao';
import { getGoogleAccessToken } from '../services/google';
import { usePendingJoinStore } from './pendingJoinStore';

/**
 * Thrown by `kakaoLogin` when Kakao OAuth could not even start because no real
 * Kakao key is configured (the placeholder is still in place). The login screen
 * catches this specifically to show a friendly "키 필요" message instead of a
 * generic error.
 */
export class KakaoNotConfiguredError extends Error {
  constructor() {
    super('카카오 로그인 설정이 준비 중이에요 (키 필요)');
    this.name = 'KakaoNotConfiguredError';
  }
}

/**
 * Thrown by `googleLogin` when Google OAuth could not start because no real
 * Google client id is configured (the placeholder is still in place). Mirrors
 * KakaoNotConfiguredError so the login screen can show the same "키 필요" message.
 */
export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('구글 로그인 설정이 준비 중이에요 (키 필요)');
    this.name = 'GoogleNotConfiguredError';
  }
}

interface User {
  id: string;
  phone: string | null;
  name: string;
  role: string;
  isGuest?: boolean;
  /** 급수 from the user's profile; null/undefined when not yet set. The gate
   *  routes a user with no skillLevel through /profile-setup. */
  skillLevel?: string | null;
  /** 성별 ('M' | 'F') from the profile; null when not set. */
  gender?: string | null;
  /** Which social providers are linked to this account (계정 연동 UI). */
  linkedProviders?: { kakao: boolean; google: boolean };
  /** True for a phone account (has a password) — counts as a login method. */
  hasPassword?: boolean;
  /**
   * 계정 상태. 운영자 회원가입한 계정은 승인 전까지 'PENDING'(앱 사용 차단),
   * 거절 시 'REJECTED', 그 외 'ACTIVE'. 루트 게이트가 이 값을 보고 승인 대기 화면으로 보낸다.
   */
  accountStatus?: 'ACTIVE' | 'PENDING' | 'REJECTED';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Derived convenience flag — true when the current session is a guest. */
  isGuest: boolean;
  login: (phone: string, password: string) => Promise<void>;
  /**
   * Player social login via Kakao (secure server-side code exchange). Runs only
   * Kakao's authorize step to get an authorization `code`, hands { code,
   * redirectUri } to our backend (which exchanges it using the client_secret —
   * never on the client), and stores the resulting JWTs exactly like a normal
   * login. Throws KakaoNotConfiguredError when no real Kakao key is configured
   * (so the UI can show a friendly "키 필요" message).
   *
   * On WEB the full-page redirect flow already holds the `{code, redirectUri}`
   * from Kakao's return URL, so it passes them in directly and this skips the
   * (popup-based) `getKakaoAuthCode` authorize step. Native passes nothing and
   * runs the authorize step as before.
   */
  kakaoLogin: (auth?: { code: string; redirectUri: string }) => Promise<{ isNew: boolean }>;
  /**
   * Player social login via Google (secure server-side code exchange). Mirrors
   * kakaoLogin: the WEB full-page redirect flow already holds the
   * { code, redirectUri } from Google's return URL and passes them in directly;
   * the backend exchanges the code using the client_secret (never on the
   * client), and the resulting JWTs are stored exactly like a normal login.
   * Throws GoogleNotConfiguredError when no { code, redirectUri } is available
   * (e.g. no real Google client id configured).
   */
  googleLogin: (auth?: { code: string; redirectUri: string }) => Promise<{ isNew: boolean }>;
  /**
   * Manual account linking (계정 연동) — attach a SECOND social provider to the
   * CURRENT authenticated account. The web link-mode OAuth round-trip already
   * holds { code, redirectUri } from the provider's return URL; these hand them
   * to the authenticated /auth/link/* endpoint, then refresh the local user
   * (loadUser) so linkedProviders updates. Throw on 409/400 so the caller can
   * surface the server message. The user's token persists across the redirect.
   */
  linkKakao: (auth: { code: string; redirectUri: string } | { accessToken: string }) => Promise<void>;
  linkGoogle: (auth: { code: string; redirectUri: string } | { accessToken: string }) => Promise<void>;
  /** Unlink a provider; refreshes the local user. Server guards ≥1 method. */
  unlinkKakao: () => Promise<void>;
  unlinkGoogle: () => Promise<void>;
  register: (phone: string, password: string, name: string) => Promise<void>;
  /**
   * 운영자(모임 관리자) 회원가입 신청. 계정을 만들고(accountStatus=PENDING) 최고관리자
   * 승인 대기 상태로 로그인시킨다 — 루트 게이트가 곧바로 승인 대기 화면으로 보낸다.
   */
  registerOperator: (data: { phone: string; password: string; name: string; clubName: string; region?: string }) => Promise<void>;
  /**
   * New-user profile completion (신규 카카오 가입자). Sets name + 급수/성별 on the
   * server, then refreshes the local user so the gate stops treating them as new.
   */
  completeProfile: (data: { name: string; skillLevel?: string; gender?: 'M' | 'F' | null }) => Promise<void>;
  /**
   * Establishes a guest session from the unauthenticated /checkin/guest
   * response. Guests have no refresh token — only an access token is stored.
   */
  setGuestSession: (params: { user: User; token: string }) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isGuest: false,

  login: async (phone, password) => {
    const { data } = await authApi.login({ phone, password });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
  },

  kakaoLogin: async (preauth) => {
    // WEB full-page redirect already obtained { code, redirectUri } from Kakao's
    // return URL → use them directly and skip the popup-based authorize step.
    // NATIVE passes nothing → run Kakao's authorize step via getKakaoAuthCode.
    const auth = preauth ?? (await getKakaoAuthCode());
    // null → either no real key (placeholder) or the user cancelled. We can't
    // distinguish a cancel from a missing key here, so surface the "키 필요"
    // path; with a real key configured a genuine cancel is a no-op for the user.
    if (!auth) {
      throw new KakaoNotConfiguredError();
    }
    // Hand the code + redirectUri to our backend, which does the secure
    // server-side token exchange (client_secret never leaves the server).
    const { data } = await authApi.kakaoLogin(auth);
    // Reuse the exact same token-storage path as phone/password login.
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
    // Surface `isNew` so the gate / login screen can route brand-new Kakao users
    // to /profile-setup before the home tabs.
    return { isNew: !!data.isNew };
  },

  googleLogin: async (preauth) => {
    // WEB full-page redirect already obtained { code, redirectUri } from Google's
    // return URL → use them directly. NATIVE passes nothing → run the native PKCE
    // authorize+exchange (getGoogleAccessToken) to obtain a Google access token.
    const auth = preauth ?? (await getGoogleAccessToken());
    // null → nothing available (no native client id / user cancelled). Surface the
    // "키 필요" path like Kakao does.
    if (!auth) {
      throw new GoogleNotConfiguredError();
    }
    // WEB → { code, redirectUri } (server exchanges w/ secret). NATIVE →
    // { accessToken } (client already exchanged via PKCE). Server accepts both.
    const { data } = await authApi.googleLogin(auth);
    // Reuse the exact same token-storage path as phone/password + kakao login.
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
    // Surface `isNew` so the gate / login screen can route brand-new Google users
    // to /profile-setup before the home tabs.
    return { isNew: !!data.isNew };
  },

  // ── Manual account linking (계정 연동) ───────────────────────────────────
  // Each calls the authenticated link/unlink endpoint, then loadUser() to pull
  // the refreshed linkedProviders/hasPassword into the local user. Errors
  // (409 already-linked / 400 last-method) propagate so the caller can toast the
  // server message. loadUser sets the returned getMe user (which now carries
  // linkedProviders), keeping the gate inputs (skillLevel/gender) intact.
  linkKakao: async (auth) => {
    await authApi.linkKakao(auth);
    await useAuthStore.getState().loadUser();
  },

  linkGoogle: async (auth) => {
    await authApi.linkGoogle(auth);
    await useAuthStore.getState().loadUser();
  },

  unlinkKakao: async () => {
    await authApi.unlinkKakao();
    await useAuthStore.getState().loadUser();
  },

  unlinkGoogle: async () => {
    await authApi.unlinkGoogle();
    await useAuthStore.getState().loadUser();
  },

  register: async (phone, password, name) => {
    const { data } = await authApi.register({ phone, password, name });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
  },

  registerOperator: async (payload) => {
    const { data } = await authApi.registerOperator(payload);
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    // accountStatus=PENDING 로 로그인 — 루트 게이트가 /operator-pending 로 보낸다.
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
  },

  completeProfile: async (data) => {
    const { data: updated } = await authApi.completeProfile(data);
    // Reflect the new name AND skillLevel/gender locally so both gate checks pass
    // (name !== '카카오회원' and skillLevel set) and the user leaves onboarding for good.
    set((state) => ({
      user: state.user
        ? { ...state.user, name: updated.name, skillLevel: updated.skillLevel ?? null, gender: updated.gender ?? null }
        : updated,
    }));
  },

  setGuestSession: async ({ user, token }) => {
    // Guests authenticate with the access token only — they have no refresh
    // token. Persist it under the same key the api interceptor reads.
    await setItem('accessToken', token);
    await deleteItem('refreshToken');
    set({ user, isAuthenticated: true, isGuest: true });
  },

  logout: async () => {
    disconnectSocket();
    try {
      await authApi.logout();
    } catch {
      // Server logout may fail if token expired - that's OK
    }
    await deleteItem('accessToken');
    await deleteItem('refreshToken');
    await deleteItem('selectedFacility');
    // Drop any leftover pending club-join so it can't carry into the next login.
    try { await usePendingJoinStore.getState().clearPendingInviteCode(); } catch { /* noop */ }
    set({ user: null, isAuthenticated: false, isGuest: false });
  },

  loadUser: async () => {
    try {
      const token = await getItem('accessToken');
      if (!token) {
        set({ isLoading: false });
        return;
      }
      // 액세스 토큰의 role/상태를 최신 서버 값으로 맞추기 위해 선제적으로 토큰을
      // 회전한다. 예: 운영자 승인으로 PLAYER→CLUB_LEADER 로 승격되면 기존 토큰엔
      // 여전히 PLAYER 가 박혀 있어 roleGuard(403)에 막힌다. 인터셉터는 401 에서만
      // 갱신하므로 403 은 못 잡는다 → 여기서 refresh(서버가 DB role 을 다시 읽어 재발급)
      // 로 새 토큰을 받아 저장. 게스트는 리프레시 토큰이 없으므로 건너뛴다.
      const refreshToken = await getItem('refreshToken');
      if (refreshToken) {
        try {
          const { data: r } = await authApi.refresh(refreshToken);
          if (r?.tokens?.accessToken) {
            await setItem('accessToken', r.tokens.accessToken);
            await setItem('refreshToken', r.tokens.refreshToken);
          }
        } catch { /* 리프레시 실패 시 기존 토큰으로 getMe 시도 */ }
      }
      const { data } = await authApi.getMe();
      set({
        user: data,
        isAuthenticated: true,
        isGuest: !!data?.isGuest,
        isLoading: false,
      });
    } catch {
      await deleteItem('accessToken');
      await deleteItem('refreshToken');
      set({ user: null, isAuthenticated: false, isGuest: false, isLoading: false });
    }
  },
}));

// Auto-logout when refresh token fails
onAuthExpired(() => {
  disconnectSocket();
  useAuthStore.setState({ user: null, isAuthenticated: false, isGuest: false });
});
