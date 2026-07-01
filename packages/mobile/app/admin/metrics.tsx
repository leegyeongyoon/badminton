import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { adminStatsApi, type AdminMetrics, type MetricGranularity, type MetricPoint } from '../../services/adminStats';

const GRANS: { key: MetricGranularity; label: string }[] = [
  { key: 'day', label: '일별' },
  { key: 'week', label: '주별' },
  { key: 'month', label: '월별' },
];

// 기간 막대 차트 — 마지막(현재 기간) 막대 강조 + 아래 x축 라벨 3개.
function TrendChart({ values, labels, color, textColor }: { values: number[]; labels: string[]; color: string; textColor: string }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const midIdx = Math.floor((n - 1) / 2);
  return (
    <View>
      <View style={styles.chart}>
        {values.map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * 60));
          const last = i === n - 1;
          return <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: color, opacity: last ? 1 : 0.32 }} />;
        })}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisT, { color: textColor }]}>{labels[0]}</Text>
        {n > 2 && <Text style={[styles.axisT, { color: textColor }]}>{labels[midIdx]}</Text>}
        <Text style={[styles.axisT, { color: textColor }]}>{labels[n - 1]}</Text>
      </View>
    </View>
  );
}

export default function AdminMetricsScreen() {
  const { colors } = useTheme();
  const [gran, setGran] = useState<MetricGranularity>('day');
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async (g: MetricGranularity) => {
    try {
      const m = await adminStatsApi.getMetrics(g);
      setData(m);
      setErrored(false);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 최초 + granularity 변경 시 로드, 그리고 15초마다 실시간 갱신(선택한 기간 유지).
  useEffect(() => {
    setLoading(true);
    load(gran);
    const t = setInterval(() => load(gran), 15000);
    return () => clearInterval(t);
  }, [load, gran]);

  const live = data?.live;
  const totals = data?.totals;
  const series = data?.series ?? [];
  const rangeLabel = series.length ? `${series[0].label} ~ ${series[series.length - 1].label}` : '';
  const perLabel = gran === 'day' ? '일' : gran === 'week' ? '주' : '월';

  const SERIES: { key: keyof MetricPoint; label: string; color: string; unit: string }[] = [
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

  const topBar = (
    <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <BackButton />
      <Text style={[styles.topBarTitle, { color: colors.text }]}>운영 지표 (최고관리자)</Text>
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
          <Text onPress={() => load(gran)} style={{ color: colors.primary, marginTop: 8, fontWeight: '700' }}>다시 시도</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(gran); }} />}
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

          {/* 추이 + 기간 전환 */}
          <View style={[styles.sectionRow, { marginTop: spacing.xl }]}>
            <Text style={[styles.section, { color: colors.text }]}>추이</Text>
            <Text style={[styles.autoHint, { color: colors.textLight }]}>{rangeLabel}</Text>
          </View>
          <View style={[styles.segment, { backgroundColor: colors.surface2 ?? colors.surfaceSecondary }]}>
            {GRANS.map((g) => {
              const active = g.key === gran;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGran(g.key)}
                  style={[styles.segBtn, active && { backgroundColor: colors.surface }]}
                >
                  <Text style={[styles.segT, { color: active ? colors.primary : colors.textSecondary }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {SERIES.map((s) => {
            const values = series.map((p) => Number(p[s.key]) || 0);
            const labels = series.map((p) => p.label);
            const latest = values.length ? values[values.length - 1] : 0;
            const prev = values.length > 1 ? values[values.length - 2] : 0;
            const delta = latest - prev;
            const total = values.reduce((a, b) => a + b, 0);
            const max = Math.max(0, ...values);
            return (
              <View key={String(s.key)} style={[styles.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.trendHead}>
                  <View style={[styles.trendDot, { backgroundColor: s.color }]} />
                  <Text style={[styles.trendLabel, { color: colors.text }]}>{s.label}</Text>
                  <View style={styles.trendVal}>
                    <Text style={[styles.trendLatest, { color: colors.text }]}>{latest.toLocaleString()}{s.unit}</Text>
                    {values.length > 1 && delta !== 0 && (
                      <Text style={[styles.trendDelta, { color: delta > 0 ? '#10B981' : colors.danger }]}>
                        {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toLocaleString()}
                      </Text>
                    )}
                  </View>
                </View>
                <TrendChart values={values} labels={labels} color={s.color} textColor={colors.textLight} />
                <Text style={[styles.trendSub, { color: colors.textLight }]}>
                  이번 {perLabel} {latest.toLocaleString()}{s.unit} · 최대 {max.toLocaleString()}{s.unit} · 합계 {total.toLocaleString()}{s.unit}
                </Text>
              </View>
            );
          })}

          {(live?.todayRequests === 0 && (totals?.users ?? 0) > 0) && (
            <Text style={[styles.note, { color: colors.textLight }]}>
              ※ 동시접속 피크·API 요청수는 기록 시작 이후부터 누적돼요(그 전 기간은 0). 활동량(정모·체크인·게임·DAU)은 기존 데이터로 계산됩니다.
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
  // 기간 세그먼트
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: spacing.md },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  segT: { ...typography.subtitle2, fontWeight: '700' },
  // 추이 카드
  trendCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  trendHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  trendDot: { width: 9, height: 9, borderRadius: 3 },
  trendLabel: { ...typography.subtitle2, fontWeight: '700' },
  trendVal: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginLeft: 'auto' },
  trendLatest: { ...typography.subtitle1, fontWeight: '800' },
  trendDelta: { ...typography.caption, fontWeight: '800' },
  trendSub: { ...typography.caption, marginTop: 8 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 60 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  axisT: { ...typography.caption, fontSize: 10 },
  note: { ...typography.caption, lineHeight: 17, marginTop: spacing.lg },
});
