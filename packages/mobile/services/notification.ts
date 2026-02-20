import api from './api';

export const notificationApi = {
  getNotifications: (page = 1) =>
    api.get('/notifications', { params: { page } }),
  markRead: (id: string) =>
    api.patch(`/notifications/${id}/read`),
  markAllRead: () =>
    api.patch('/notifications/read-all'),
};
