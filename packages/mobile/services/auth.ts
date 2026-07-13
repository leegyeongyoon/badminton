import api from './api';

export const authApi = {
  register: (data: { phone: string; password: string; name: string }) =>
    api.post('/auth/register', data),

  // 운영자(모임 관리자) 회원가입 신청 — 계정 생성 + 최고관리자 승인 대기.
  registerOperator: (data: { phone: string; password: string; name: string; clubName: string; region?: string }) =>
    api.post('/auth/register-operator', data),

  login: (data: { phone: string; password: string }) =>
    api.post('/auth/login', data),

  // WEB sends { code, redirectUri } (server exchanges w/ secret); NATIVE sends
  // { accessToken } (Kakao SDK returned it) — server accepts both.
  kakaoLogin: (data: { code: string; redirectUri: string } | { accessToken: string }) =>
    api.post('/auth/kakao', data),

  // WEB sends { code, redirectUri } (server exchanges w/ secret); NATIVE sends
  // { accessToken } (client did the PKCE exchange, no secret) — server accepts both.
  googleLogin: (data: { code: string; redirectUri: string } | { accessToken: string }) =>
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
  // provider to the current account. Web sends { code, redirectUri }; native
  // sends { accessToken } from the provider's native SDK. Mirrors login.
  linkKakao: (data: { code: string; redirectUri: string } | { accessToken: string }) =>
    api.post('/auth/link/kakao', data),

  linkGoogle: (data: { code: string; redirectUri: string } | { accessToken: string }) =>
    api.post('/auth/link/google', data),

  // Unlink a provider (authenticated). Server guards "keep ≥1 login method".
  unlinkKakao: () => api.post('/auth/unlink/kakao'),

  unlinkGoogle: () => api.post('/auth/unlink/google'),

  updatePushToken: (token: string) =>
    api.post('/auth/push-token', { token }),

  getMe: () => api.get('/auth/me'),
};
