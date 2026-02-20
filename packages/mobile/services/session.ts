import api from './api';

export const sessionApi = {
  openSession: (facilityId: string, note?: string) =>
    api.post(`/facilities/${facilityId}/sessions/open`, { note }),
  closeSession: (sessionId: string) =>
    api.post(`/sessions/${sessionId}/close`),
  getCurrentSession: (facilityId: string) =>
    api.get(`/facilities/${facilityId}/sessions/current`),
};
