import api from './api';

export const authApi = {
  register: (data: { phone: string; password: string; name: string }) =>
    api.post('/auth/register', data),

  login: (data: { phone: string; password: string }) =>
    api.post('/auth/login', data),

  kakaoLogin: (data: { code: string; redirectUri: string }) =>
    api.post('/auth/kakao', data),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  logout: () => api.post('/auth/logout'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),

  // New-user profile completion (신규 카카오 가입자 프로필 설정).
  completeProfile: (data: { name: string; skillLevel?: string; gender?: 'M' | 'F' | null }) =>
    api.post('/auth/complete-profile', data),

  updatePushToken: (token: string) =>
    api.post('/auth/push-token', { token }),

  getMe: () => api.get('/auth/me'),
};
