import { create } from 'zustand';
import { getItem, setItem, deleteItem } from '../services/storage';
import { authApi } from '../services/auth';

interface User {
  id: string;
  phone: string;
  name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (phone, password) => {
    const { data } = await authApi.login({ phone, password });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true });
  },

  register: async (phone, password, name) => {
    const { data } = await authApi.register({ phone, password, name });
    await setItem('accessToken', data.tokens.accessToken);
    await setItem('refreshToken', data.tokens.refreshToken);
    set({ user: data.user, isAuthenticated: true });
  },

  logout: async () => {
    await deleteItem('accessToken');
    await deleteItem('refreshToken');
    set({ user: null, isAuthenticated: false });
  },

  loadUser: async () => {
    try {
      const token = await getItem('accessToken');
      if (!token) {
        set({ isLoading: false });
        return;
      }
      const { data } = await authApi.getMe();
      set({ user: data, isAuthenticated: true, isLoading: false });
    } catch {
      await deleteItem('accessToken');
      await deleteItem('refreshToken');
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
