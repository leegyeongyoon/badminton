import axios from 'axios';
import { getItem, setItem, deleteItem } from './storage';
import { API_URL } from '../constants/api';

// Listeners for auth state changes (e.g., forced logout)
type AuthListener = () => void;
const authListeners: AuthListener[] = [];
export function onAuthExpired(listener: AuthListener) {
  authListeners.push(listener);
  return () => {
    const idx = authListeners.indexOf(listener);
    if (idx >= 0) authListeners.splice(idx, 1);
  };
}
function notifyAuthExpired() {
  authListeners.forEach((fn) => fn());
}

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await getItem('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        // Use plain axios to avoid interceptor loop
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
        await setItem('accessToken', data.tokens.accessToken);
        await setItem('refreshToken', data.tokens.refreshToken);
        originalRequest.headers.Authorization = `Bearer ${data.tokens.accessToken}`;
        return api(originalRequest);
      } catch {
        await deleteItem('accessToken');
        await deleteItem('refreshToken');
        await deleteItem('selectedFacility');
        notifyAuthExpired();
      }
    }
    return Promise.reject(error);
  },
);

export default api;
