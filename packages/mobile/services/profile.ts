import api from './api';

export const profileApi = {
  getProfile: () =>
    api.get('/users/me/profile'),
  updateProfile: (data: { skillLevel?: string; preferredGameTypes?: string[]; gender?: string | null; birthYear?: number | null }) =>
    api.put('/users/me/profile', data),
  getStats: () =>
    api.get('/users/me/stats'),
  getHistory: (page = 1) =>
    api.get('/users/me/history', { params: { page } }),
  getPenalties: () =>
    api.get('/users/me/penalties'),
};
