import api from './api';

export const courtApi = {
  updateStatus: (courtId: string, status: string) =>
    api.patch(`/courts/${courtId}/status`, { status }),
  createHold: (courtId: string, clubId: string) =>
    api.post(`/courts/${courtId}/hold`, { clubId }),
  getHold: (courtId: string) =>
    api.get(`/courts/${courtId}/hold`),
  releaseHold: (holdId: string) =>
    api.delete(`/holds/${holdId}`),
};
