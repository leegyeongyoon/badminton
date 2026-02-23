import api from './api';

export const gameApi = {
  getHistory: (page: number = 1, limit: number = 20) =>
    api.get(`/games/history?page=${page}&limit=${limit}`),
};
