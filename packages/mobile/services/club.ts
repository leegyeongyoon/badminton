import api from './api';

export const clubApi = {
  list: () => api.get('/clubs'),
  create: (name: string) => api.post('/clubs', { name }),
  join: (inviteCode: string) => api.post('/clubs/join', { inviteCode }),
  getMembers: (clubId: string) => api.get(`/clubs/${clubId}/members`),
};
