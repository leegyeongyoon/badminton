import api from './api';

const silent = { _silent: true } as any;

export const statsApi = {
  getMyStats: () => api.get('/users/me/stats'),
  getMyPenalties: () => api.get('/users/me/penalties'),

  getWeeklyStats: async (): Promise<{ day: string; count: number }[]> => {
    const { data } = await api.get('/users/me/stats/weekly', silent);
    return data || [];
  },

  getGameTypeDistribution: async (): Promise<
    { label: string; value: number; color: string }[]
  > => {
    const { data } = await api.get('/users/me/stats/game-types', silent);
    return data || [];
  },

  getTotalStats: async (): Promise<{
    totalGames: number;
    consecutiveDays: number;
  }> => {
    const { data } = await api.get('/users/me/stats/total', silent);
    return data || { totalGames: 0, consecutiveDays: 0 };
  },
};
