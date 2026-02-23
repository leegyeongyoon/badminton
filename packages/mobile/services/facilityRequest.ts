import api from './api';

export const facilityRequestApi = {
  createRequest: (input: { name: string; address: string }) =>
    api.post('/facilities/requests', input),
  getMyRequests: () =>
    api.get('/facilities/requests/mine'),
  listRequests: (status?: string) =>
    api.get(`/facilities/requests${status ? `?status=${status}` : ''}`),
  reviewRequest: (id: string, data: { approved: boolean; reviewNote?: string }) =>
    api.post(`/facilities/requests/${id}/review`, data),
};
