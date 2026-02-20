import api from './api';

export const automatchApi = {
  joinPool: (facilityId: string, gameType: string) =>
    api.post(`/facilities/${facilityId}/automatch/join`, { gameType }),
  leavePool: (facilityId: string) =>
    api.delete(`/facilities/${facilityId}/automatch/leave`),
  getPool: (facilityId: string) =>
    api.get(`/facilities/${facilityId}/automatch/pool`),
};
