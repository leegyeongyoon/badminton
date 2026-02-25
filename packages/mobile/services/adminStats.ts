import api from './api';

const silent = { _silent: true } as any;

export const adminStatsApi = {
  getWeeklyTrends: async (facilityId: string): Promise<{ day: string; count: number }[]> => {
    const { data } = await api.get(`/facilities/${facilityId}/stats/weekly`, silent);
    return data || [];
  },

  getPeakHours: async (facilityId: string): Promise<{ hours: string[]; days: string[]; data: number[][] }> => {
    const { data } = await api.get(`/facilities/${facilityId}/stats/peak-hours`, silent);
    return data || { hours: [], days: [], data: [] };
  },

  getTodayStats: async (facilityId: string) => {
    const { data } = await api.get(`/facilities/${facilityId}/stats/today`);
    return data;
  },
};
