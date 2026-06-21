import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';
import { authApi } from '../services/auth';
import { onAuthExpired } from '../services/api';
import { disconnectSocket } from '../hooks/useSocket';
import { getKakaoAuthCode } from '../services/kakao';
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
   */
  kakaoLogin: () => Promise<{ isNew: boolean }>;
  register: (phone: string, password: string, name: string) => Promise<void>;
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

  kakaoLogin: async () => {
    const auth = await getKakaoAuthCode();
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

  register: async (phone, password, name) => {
    const { data } = await authApi.register({ phone, password, name });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
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
