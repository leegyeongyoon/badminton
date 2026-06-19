import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { adminStatsApi } from '../services/adminStats';

interface SessionInfo {
  id: string;
  status: string;
  openedByName: string;
  openedAt: string;
}

interface TurnPlayer {
  userId: string;
  user: { name: string };
}

interface TurnInfo {
  id: string;
  status: string;
  position: number;
  players: TurnPlayer[];
}

interface CourtInfo {
  id: string;
  name: string;
  status: string;
  gameType: string;
  turns: TurnInfo[];
}

interface CheckedInUser {
  userId: string;
  userName: string;
  checkedInAt: string;
  status?: string;
}

interface Capacity {
  totalCheckedIn: number;
  availableCount: number;
  inTurnCount: number;
  restingCount: number;
  totalCourts: number;
  activeCourts: number;
}

interface TodayStats {
  totalGames: number;
  avgWaitMinutes: number;
  peakPlayers: number;
}

export function useAdminData(facilityId: string | undefined) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [courts, setCourts] = useState<CourtInfo[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [checkedInUsers, setCheckedInUsers] = useState<CheckedInUser[]>([]);
  const [weeklyTrends, setWeeklyTrends] = useState<{ day: string; count: number }[]>([]);
  const [peakHours, setPeakHours] = useState<{ hours: string[]; days: string[]; data: number[][] }>({ hours: [], days: [], data: [] });
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!facilityId) return;
    try {
      const [sessionRes, courtsRes, capacityRes, statsRes, playersRes, weeklyTrendsRes, peakHoursRes] = await Promise.all([
        api.get(`/facilities/${facilityId}/sessions/current`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/courts`).catch(() => ({ data: [] })),
        api.get(`/facilities/${facilityId}/capacity`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/stats/today`).catch(() => ({ data: null })),
        api.get(`/facilities/${facilityId}/players`).catch(() => ({ data: [] })),
        adminStatsApi.getWeeklyTrends(facilityId).catch(() => []),
        adminStatsApi.getPeakHours(facilityId).catch(() => ({ hours: [], days: [], data: [] })),
      ]);
      setSession(sessionRes.data);
      setCourts(courtsRes.data || []);
      setCapacity(capacityRes.data);
      setTodayStats(statsRes.data);
      setCheckedInUsers((playersRes.data || []).map((p: any) => ({
        userId: p.userId,
        userName: p.userName,
        checkedInAt: p.checkedInAt,
        status: p.status,
      })));
      setWeeklyTrends(weeklyTrendsRes as { day: string; count: number }[]);
      setPeakHours(peakHoursRes as { hours: string[]; days: string[]; data: number[][] });
    } catch { /* silent */ }
  }, [facilityId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return {
    session,
    courts,
    capacity,
    todayStats,
    checkedInUsers,
    weeklyTrends,
    peakHours,
    refreshing,
    onRefresh,
    loadData,
  };
}
