import { useState, useEffect, useCallback } from 'react';
import { statsApi } from '../services/stats';

interface StatsData {
  weeklyStats: { day: string; count: number }[];
  gameTypeData: { label: string; value: number; color: string }[];
  totalStats: { totalGames: number; consecutiveDays: number };
}

export function useStatsData() {
  const [data, setData] = useState<StatsData>({
    weeklyStats: [],
    gameTypeData: [],
    totalStats: { totalGames: 0, consecutiveDays: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [weeklyStats, gameTypeData, totalStats] = await Promise.all([
        statsApi.getWeeklyStats().catch(() => []),
        statsApi.getGameTypeDistribution().catch(() => []),
        statsApi.getTotalStats().catch(() => ({ totalGames: 0, consecutiveDays: 0 })),
      ]);
      setData({ weeklyStats, gameTypeData, totalStats });
    } catch {
      setError('통계 데이터를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return { ...data, loading, error, retry: loadStats };
}
