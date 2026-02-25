import axios, { AxiosError } from 'axios';
import { getItem, setItem, deleteItem } from './storage';
import { API_URL } from '../constants/api';
import { showError } from '../utils/feedback';
import { Strings } from '../constants/strings';

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
  timeout: 15000,
});

// Retry helper: retries once after 1s on network errors (not 4xx/5xx client errors)
function isRetryable(error: AxiosError): boolean {
  // Don't retry if we got a response (4xx, 5xx are server responses)
  if (error.response) return false;
  // Retry on network errors, timeouts
  return error.code === 'ECONNABORTED' || error.message === 'Network Error' || !error.response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFriendlyErrorMessage(error: AxiosError): string {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') return Strings.errors.timeout;
    return Strings.errors.network;
  }
  const status = error.response.status;
  const serverMessage = (error.response.data as any)?.message;
  if (serverMessage) return serverMessage;
  if (status === 403) return Strings.errors.forbidden;
  if (status === 404) return Strings.errors.notFound;
  if (status >= 500) return Strings.errors.serverError;
  return Strings.errors.unknown;
}

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

// Global error interceptor with 1-retry for network errors
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // Skip if this is already a retry or a 401 (handled above)
    if (originalRequest?._networkRetry || error.response?.status === 401) {
      // Show error toast for non-401 errors (unless suppressed)
      if (error.response?.status !== 401 && !originalRequest?._silent) {
        const message = getFriendlyErrorMessage(error);
        showError(message);
      }
      return Promise.reject(error);
    }

    // Retry once on network/timeout errors
    if (isRetryable(error) && originalRequest) {
      originalRequest._networkRetry = true;
      await delay(1000);
      return api(originalRequest);
    }

    // Show error toast for unhandled errors (not 401, not silent)
    if (error.response?.status !== 401 && !originalRequest?._silent) {
      const message = getFriendlyErrorMessage(error);
      showError(message);
    }

    return Promise.reject(error);
  },
);

export default api;
