import api from './api';

export const facilityApi = {
  list: () => api.get('/facilities'),
  get: (id: string) => api.get(`/facilities/${id}`),
  getQr: (id: string) => api.get(`/facilities/${id}/qr`),
  getPolicy: (id: string) => api.get(`/facilities/${id}/policy`),
  updatePolicy: (id: string, data: any) => api.put(`/facilities/${id}/policy`, data),
  getBoard: (id: string) => api.get(`/facilities/${id}/board`),
  getCourts: (id: string) => api.get(`/facilities/${id}/courts`),
  getPlayers: (id: string) => api.get(`/facilities/${id}/players`),
  getCapacity: (id: string) => api.get(`/facilities/${id}/capacity`),
  getCurrentSession: (id: string) => api.get(`/facilities/${id}/sessions/current`),
  openSession: (id: string, note?: string) => api.post(`/facilities/${id}/sessions/open`, { note }),
};
