import api from './api';

export const authApi = {
  register: (data: { phone: string; password: string; name: string }) =>
    api.post('/auth/register', data),

  login: (data: { phone: string; password: string }) =>
    api.post('/auth/login', data),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  updatePushToken: (token: string) =>
    api.post('/auth/push-token', { token }),

  getMe: () => api.get('/auth/me'),
};
