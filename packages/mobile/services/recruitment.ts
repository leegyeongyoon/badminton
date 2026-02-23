import api from './api';

export const recruitmentApi = {
  create: (facilityId: string, data: {
    gameType?: string;
    targetCourtId?: string;
    message?: string;
    initialMemberIds?: string[];
  }) => api.post(`/facilities/${facilityId}/recruitments`, data),

  list: (facilityId: string) =>
    api.get(`/facilities/${facilityId}/recruitments`),

  join: (recruitmentId: string) =>
    api.post(`/recruitments/${recruitmentId}/join`),

  leave: (recruitmentId: string) =>
    api.post(`/recruitments/${recruitmentId}/leave`),

  register: (recruitmentId: string, courtId: string) =>
    api.post(`/recruitments/${recruitmentId}/register`, { courtId }),

  cancel: (recruitmentId: string) =>
    api.delete(`/recruitments/${recruitmentId}`),
};
