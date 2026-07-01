import api from './api';

const silent = { _silent: true } as any;

// ─── 슈퍼관리자 운영 지표(대시보드) ───
export type MetricGranularity = 'day' | 'week' | 'month';
export interface MetricPoint {
  key: string;
  label: string; // 화면 표시용 짧은 라벨
  dau: number;
  newUsers: number;
  checkins: number;
  sessions: number;
  games: number;
  peakConnections: number;
  requestCount: number;
}
export interface AdminMetrics {
  live: {
    currentConnections: number;
    todayPeakConnections: number;
    todayRequests: number;
    todayDau: number;
    activeSessions: number;
    checkedInNow: number;
  };
  totals: { members: number; guests: number; clubs: number; facilities: number };
  granularity: MetricGranularity;
  series: MetricPoint[]; // 오래된→최신
  hourly: number[]; // 0~23시 체크인 분포(피크타임)
}

export type WhoScope = 'online' | 'checkedin' | 'today';
export interface WhoUser { userId: string; name: string; isGuest: boolean; context?: string; at?: string }
export interface WhoResponse { scope: WhoScope; count: number; users: WhoUser[] }

export const adminStatsApi = {
  getMetrics: async (granularity: MetricGranularity = 'day', count?: number): Promise<AdminMetrics> => {
    const { data } = await api.get('/admin/metrics', { params: { granularity, ...(count ? { count } : {}) } });
    return data;
  },
  getWho: async (scope: WhoScope): Promise<WhoResponse> => {
    const { data } = await api.get('/admin/metrics/who', { params: { scope } });
    return data;
  },

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
