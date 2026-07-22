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

// ── 한글 NFC 정규화 ────────────────────────────────────────────────
// Android는 NFD(자모 분해형) 한글을 "ㅜ체ㅐㅑㅎ"처럼 분리된 자모로 렌더한다.
// Mac/iOS에서 입력된 모임명·이름 등이 NFD로 저장돼 있으면 안드로이드에서 깨져 보여서,
// 응답 본문의 모든 문자열을 NFC(조합형)로 정규화한다. ASCII(토큰/ID/날짜/URL)는
// NFC와 항상 동일하므로 정규화하지 않고 건너뛴다(성능). JSON은 순환 참조가 없지만
// 만일을 대비해 depth 가드를 둔다.
const NON_ASCII = /[^\x00-\x7F]/;
function deepNfc(v: any, depth = 0): any {
  if (v == null || depth > 12) return v;
  if (typeof v === 'string') return NON_ASCII.test(v) ? v.normalize('NFC') : v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = deepNfc(v[i], depth + 1);
    return v;
  }
  if (typeof v === 'object') {
    for (const k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = deepNfc(v[k], depth + 1);
    }
  }
  return v;
}

api.interceptors.response.use(
  (response) => {
    try {
      response.data = deepNfc(response.data);
    } catch {
      /* 정규화 실패해도 원본 그대로 사용 (표시 이슈일 뿐) */
    }
    return response;
  },
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
