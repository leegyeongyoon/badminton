import api from './api';

export const clubSessionApi = {
  start: (clubId: string, data: { facilityId: string; courtIds?: string[] }) =>
    api.post(`/clubs/${clubId}/sessions`, data),
  getActive: (clubId: string) =>
    api.get(`/clubs/${clubId}/sessions/active`),
  updateCourts: (sessionId: string, courtIds: string[]) =>
    api.patch(`/club-sessions/${sessionId}/courts`, { courtIds }),
  end: (sessionId: string) =>
    api.post(`/club-sessions/${sessionId}/end`),
  bulkRegisterTurns: (sessionId: string, turns: Array<{ courtId: string; playerIds: string[]; gameType?: string }>) =>
    api.post(`/club-sessions/${sessionId}/turns/bulk`, { turns }),
  updateMemberRole: (clubId: string, userId: string, role: string) =>
    api.patch(`/clubs/${clubId}/members/${userId}/role`, { role }),
};
