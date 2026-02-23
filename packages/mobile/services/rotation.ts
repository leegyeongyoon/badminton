import api from './api';

export const rotationApi = {
  generate: (facilityId: string, data: {
    playerIds?: string[];
    courtIds?: string[];
    targetRounds?: number;
  }) => api.post(`/facilities/${facilityId}/rotation/generate`, data),

  getCurrent: (facilityId: string) =>
    api.get(`/facilities/${facilityId}/rotation/current`),

  getDetail: (scheduleId: string) =>
    api.get(`/rotation/${scheduleId}`),

  start: (scheduleId: string) =>
    api.post(`/rotation/${scheduleId}/start`),

  cancel: (scheduleId: string) =>
    api.post(`/rotation/${scheduleId}/cancel`),

  regenerate: (scheduleId: string) =>
    api.post(`/rotation/${scheduleId}/regenerate`),
};
