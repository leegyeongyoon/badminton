import api from './api';

export const checkinApi = {
  checkIn: (qrData: string) => api.post('/checkin', { qrData }),
  checkOut: () => api.post('/checkin/checkout'),
  getStatus: () => api.get('/checkin/status'),
};
