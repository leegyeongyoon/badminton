import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, RefreshControl, ActivityIndicator } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { adminStatsApi, type AdminMetrics } from '../../services/adminStats';

// 최근 N일 미니 막대 차트(의존성 0). 마지막(오늘) 막대를 진하게.
function MiniBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <View style={styles.bars}>
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 40));
        const last = i === values.length - 1;
        return <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: color, opacity: last ? 1 : 0.35 }} />;
      })}
    </View>
  );
}

export default function AdminMetricsScreen() {
  const { colors } = useTheme();
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await adminStatsApi.getMetrics(14);
      setData(m);
      setErrored(false);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 최초 + 15초마다 자동 갱신(실시간 접속수/요청수).
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const topBar = (
    <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <BackButton />
      <Text style={[styles.topBarTitle, { color: colors.text }]}>운영 지표 (최고관리자)</Text>
    </View>
  );

  const live = data?.live;
  const totals = data?.totals;
  const daily = data?.daily ?? [];
  const rangeLabel = daily.length ? `${daily[0].date.slice(5)} ~ ${daily[daily.length - 1].date.slice(5)}` : '';

  const SERIES: { key: keyof AdminMetrics['daily'][number]; label: string; color: string; unit: string }[] = [
    { key: 'peakConnections', label: '동시접속 피크', color: colors.primary, unit: '' },
    { key: 'requestCount', label: 'API 요청수', color: '#8B5CF6', unit: '' },
    { key: 'dau', label: '활성 사용자(DAU)', color: '#10B981', unit: '명' },
    { key: 'checkins', label: '체크인', color: '#0EA5E9', unit: '건' },
    { key: 'newUsers', label: '신규 가입', color: '#F59E0B', unit: '명' },
    { key: 'sessions', label: '정모', color: '#EF4444', unit: '개' },
    { key: 'games', label: '게임', color: '#EC4899', unit: '판' },
  ];

  const LiveStat = ({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) => (
    <View style={[styles.liveCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.liveValue, { color: accent ? colors.primary : colors.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.liveLabel, { color: colors.textSecondary }]} numberOfLines={1}>{label}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {topBar}
      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : errored && !data ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>지표를 불러오지 못했어요</Text>
          <Text onPress={load} style={{ color: colors.primary, marginTop: 8, fontWeight: '700' }}>다시 시도</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* 실시간 */}
          <View style={styles.sectionRow}>
            <Text style={[styles.section, { color: colors.text }]}>실시간</Text>
            <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.autoHint, { color: colors.textLight }]}>15초마다 자동 갱신</Text>
          </View>
          <View style={styles.grid}>
            <LiveStat label="현재 접속" value={live?.currentConnections ?? 0} accent />
            <LiveStat label="오늘 피크" value={live?.todayPeakConnections ?? 0} />
            <LiveStat label="오늘 요청수" value={(live?.todayRequests ?? 0).toLocaleString()} />
            <LiveStat label="진행 중 정모" value={live?.activeSessions ?? 0} />
            <LiveStat label="지금 체크인" value={live?.checkedInNow ?? 0} />
            <LiveStat label="오늘 DAU" value={live?.todayDau ?? 0} />
          </View>

          {/* 누적 */}
          <Text style={[styles.section, { color: colors.text, marginTop: spacing.xl }]}>누적</Text>
          <View style={styles.grid}>
            <LiveStat label="총 사용자" value={(totals?.users ?? 0).toLocaleString()} />
            <LiveStat label="총 모임" value={totals?.clubs ?? 0} />
            <LiveStat label="총 시설" value={totals?.facilities ?? 0} />
          </View>

          {/* 일별 추이 */}
          <View style={[styles.sectionRow, { marginTop: spacing.xl }]}>
            <Text style={[styles.section, { color: colors.text }]}>일별 추이 (14일)</Text>
            <Text style={[styles.autoHint, { color: colors.textLight }]}>{rangeLabel}</Text>
          </View>
          {SERIES.map((s) => {
            const values = daily.map((d) => Number(d[s.key]) || 0);
            const today = values.length ? values[values.length - 1] : 0;
            const total = values.reduce((a, b) => a + b, 0);
            return (
              <View key={String(s.key)} style={[styles.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.trendHead}>
                  <View style={[styles.trendDot, { backgroundColor: s.color }]} />
                  <Text style={[styles.trendLabel, { color: colors.text }]}>{s.label}</Text>
                  <Text style={[styles.trendToday, { color: colors.text }]}>오늘 {today.toLocaleString()}{s.unit}</Text>
                </View>
                <MiniBars values={values} color={s.color} />
                <Text style={[styles.trendSub, { color: colors.textLight }]}>14일 합계 {total.toLocaleString()}{s.unit}</Text>
              </View>
            );
          })}

          {(live?.todayRequests === 0 && (totals?.users ?? 0) > 0) && (
            <Text style={[styles.note, { color: colors.textLight }]}>
              ※ 동시접속 피크·API 요청수는 기록 시작 이후부터 누적돼요(과거 값은 0). 활동량(정모·체크인·게임·DAU)은 기존 데이터로 계산됩니다.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 10, borderBottomWidth: 1,
  },
  topBarTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  section: { ...typography.subtitle1, fontWeight: '800' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  autoHint: { ...typography.caption, marginLeft: 'auto' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  liveCard: {
    flexGrow: 1, flexBasis: '30%', minWidth: 100, borderWidth: 1, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, alignItems: 'flex-start', gap: 2,
  },
  liveValue: { ...typography.h2, fontWeight: '800' },
  liveLabel: { ...typography.caption, fontWeight: '600' },
  trendCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  trendHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  trendDot: { width: 9, height: 9, borderRadius: 3 },
  trendLabel: { ...typography.subtitle2, fontWeight: '700' },
  trendToday: { ...typography.subtitle2, fontWeight: '800', marginLeft: 'auto' },
  trendSub: { ...typography.caption, marginTop: 6 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 40 },
  note: { ...typography.caption, lineHeight: 17, marginTop: spacing.lg },
});
