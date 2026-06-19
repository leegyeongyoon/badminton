import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';
import { authApi } from '../services/auth';
import { onAuthExpired } from '../services/api';
import { disconnectSocket } from '../hooks/useSocket';

interface User {
  id: string;
  phone: string | null;
  name: string;
  role: string;
  isGuest?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Derived convenience flag — true when the current session is a guest. */
  isGuest: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, name: string) => Promise<void>;
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

  register: async (phone, password, name) => {
    const { data } = await authApi.register({ phone, password, name });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true, isGuest: !!data.user?.isGuest });
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
