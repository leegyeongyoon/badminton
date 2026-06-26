import api from './api';

export const authApi = {
  register: (data: { phone: string; password: string; name: string }) =>
    api.post('/auth/register', data),

  login: (data: { phone: string; password: string }) =>
    api.post('/auth/login', data),

  kakaoLogin: (data: { code: string; redirectUri: string }) =>
    api.post('/auth/kakao', data),

  googleLogin: (data: { code: string; redirectUri: string }) =>
    api.post('/auth/google', data),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  logout: () => api.post('/auth/logout'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),

  // New-user profile completion (신규 카카오 가입자 프로필 설정).
  completeProfile: (data: { name: string; skillLevel?: string; gender?: 'M' | 'F' | null }) =>
    api.post('/auth/complete-profile', data),

  // Manual account linking (계정 연동) — authenticated. Attach a SECOND social
  // provider to the current account; body { code, redirectUri } mirrors login.
  linkKakao: (data: { code: string; redirectUri: string }) =>
    api.post('/auth/link/kakao', data),

  linkGoogle: (data: { code: string; redirectUri: string }) =>
    api.post('/auth/link/google', data),

  // Unlink a provider (authenticated). Server guards "keep ≥1 login method".
  unlinkKakao: () => api.post('/auth/unlink/kakao'),

  unlinkGoogle: () => api.post('/auth/unlink/google'),

  updatePushToken: (token: string) =>
    api.post('/auth/push-token', { token }),

  getMe: () => api.get('/auth/me'),
};
