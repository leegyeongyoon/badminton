import api from './api';

export const queueApi = {
  joinQueue: (courtId: string, clubId?: string) =>
    api.post(`/courts/${courtId}/queue`, clubId ? { clubId } : {}),
  leaveQueue: (courtId: string, clubId?: string) =>
    api.delete(`/courts/${courtId}/queue`, { data: clubId ? { clubId } : {} }),
  getQueue: (courtId: string) =>
    api.get(`/courts/${courtId}/queue`),
  acceptOffer: (courtId: string, clubId?: string) =>
    api.post(`/courts/${courtId}/queue/accept`, clubId ? { clubId } : {}),
};
