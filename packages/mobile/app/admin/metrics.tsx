import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, RefreshControl, ActivityIndicator, Pressable, Modal } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { Icon } from '../../components/ui/Icon';
import {
  adminStatsApi,
  type AdminMetrics, type MetricGranularity, type MetricPoint,
  type WhoScope, type WhoResponse,
} from '../../services/adminStats';

const GRANS: { key: MetricGranularity; label: string }[] = [
  { key: 'day', label: '일별' },
  { key: 'week', label: '주별' },
  { key: 'month', label: '월별' },
];

// 표/차트에 함께 쓰는 지표 정의(순서 = 표 컬럼 순서).
const METRICS: { key: keyof MetricPoint; short: string; label: string; color: string; unit: string }[] = [
  { key: 'peakConnections', short: '피크', label: '동시접속 피크', color: '#14B8A6', unit: '' },
  { key: 'requestCount', short: '요청', label: 'API 요청수', color: '#8B5CF6', unit: '' },
  { key: 'dau', short: 'DAU', label: '활성 사용자(DAU)', color: '#10B981', unit: '명' },
  { key: 'checkins', short: '체크인', label: '체크인', color: '#0EA5E9', unit: '건' },
  { key: 'newUsers', short: '신규', label: '신규 가입', color: '#F59E0B', unit: '명' },
  { key: 'sessions', short: '정모', label: '정모', color: '#EF4444', unit: '개' },
  { key: 'games', short: '게임', label: '게임', color: '#EC4899', unit: '판' },
];

function TrendChart({ values, labels, color, textColor }: { values: number[]; labels: string[]; color: string; textColor: string }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  return (
    <View>
      <View style={styles.chart}>
        {values.map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * 56));
          const last = i === n - 1;
          return <View key={i} style={{ flex: 1, height: h, borderRadius: 2, backgroundColor: color, opacity: last ? 1 : 0.32 }} />;
        })}
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisT, { color: textColor }]}>{labels[0]}</Text>
        {n > 2 && <Text style={[styles.axisT, { color: textColor }]}>{labels[Math.floor((n - 1) / 2)]}</Text>}
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

  // 드릴다운 모달
  const [whoScope, setWhoScope] = useState<WhoScope | null>(null);
  const [who, setWho] = useState<WhoResponse | null>(null);
  const [whoLoading, setWhoLoading] = useState(false);

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

  useEffect(() => {
    setLoading(true);
    load(gran);
    const t = setInterval(() => load(gran), 15000);
    return () => clearInterval(t);
  }, [load, gran]);

  const openWho = useCallback(async (scope: WhoScope) => {
    setWhoScope(scope);
    setWho(null);
    setWhoLoading(true);
    try { setWho(await adminStatsApi.getWho(scope)); } catch { setWho(null); } finally { setWhoLoading(false); }
  }, []);

  const live = data?.live;
  const totals = data?.totals;
  const series = data?.series ?? [];
  const hourly = data?.hourly ?? [];
  const rangeLabel = series.length ? `${series[0].label} ~ ${series[series.length - 1].label}` : '';
  const perLabel = gran === 'day' ? '일' : gran === 'week' ? '주' : '월';
  const peakHour = hourly.length ? hourly.indexOf(Math.max(...hourly)) : -1;
  const hourlyMax = hourly.length ? Math.max(1, ...hourly) : 1;

  // 탭 가능한 실시간 카드
  const StatCard = ({ label, value, accent, onPress }: { label: string; value: number | string; accent?: boolean; onPress?: () => void }) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.liveCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && onPress ? { opacity: 0.6 } : null]}
    >
      <View style={styles.liveTop}>
        <Text style={[styles.liveValue, { color: accent ? colors.primary : colors.text }]} numberOfLines={1}>{value}</Text>
        {onPress && <Icon name="chevronRight" size={14} color={colors.textLight} />}
      </View>
      <Text style={[styles.liveLabel, { color: colors.textSecondary }]} numberOfLines={1}>{label}{onPress ? ' ›' : ''}</Text>
    </Pressable>
  );

  const topBar = (
    <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <BackButton />
      <Text style={[styles.topBarTitle, { color: colors.text }]}>운영 지표 (최고관리자)</Text>
    </View>
  );

  const whoTitle = whoScope === 'online' ? '현재 접속 중' : whoScope === 'checkedin' ? '지금 체크인' : '오늘 활동(체크인)';

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
          {/* 실시간 (탭하면 명단) */}
          <View style={styles.sectionRow}>
            <Text style={[styles.section, { color: colors.text }]}>실시간</Text>
            <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.autoHint, { color: colors.textLight }]}>탭하면 명단 · 15초 자동 갱신</Text>
          </View>
          <View style={styles.grid}>
            <StatCard label="현재 접속" value={live?.currentConnections ?? 0} accent onPress={() => openWho('online')} />
            <StatCard label="지금 체크인" value={live?.checkedInNow ?? 0} onPress={() => openWho('checkedin')} />
            <StatCard label="오늘 DAU" value={live?.todayDau ?? 0} onPress={() => openWho('today')} />
            <StatCard label="진행 중 정모" value={live?.activeSessions ?? 0} />
            <StatCard label="오늘 피크" value={live?.todayPeakConnections ?? 0} />
            <StatCard label="오늘 요청수" value={(live?.todayRequests ?? 0).toLocaleString()} />
          </View>

          {/* 누적 (회원/게스트 분리) */}
          <Text style={[styles.section, { color: colors.text, marginTop: spacing.xl }]}>누적</Text>
          <View style={styles.grid}>
            <StatCard label="회원" value={(totals?.members ?? 0).toLocaleString()} />
            <StatCard label="게스트(누적)" value={(totals?.guests ?? 0).toLocaleString()} />
            <StatCard label="모임" value={totals?.clubs ?? 0} />
            <StatCard label="시설" value={totals?.facilities ?? 0} />
          </View>

          {/* 시간대별 피크 */}
          <View style={[styles.sectionRow, { marginTop: spacing.xl }]}>
            <Text style={[styles.section, { color: colors.text }]}>시간대별 피크</Text>
            {peakHour >= 0 && <Text style={[styles.autoHint, { color: colors.textLight }]}>가장 붐빔: {peakHour}시</Text>}
          </View>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.hourChart}>
              {hourly.map((v, h) => (
                <View key={h} style={{ flex: 1, height: Math.max(2, Math.round((v / hourlyMax) * 64)), borderRadius: 1.5, backgroundColor: h === peakHour ? colors.primary : colors.primary, opacity: h === peakHour ? 1 : 0.3 }} />
              ))}
            </View>
            <View style={styles.axis}>
              {[0, 6, 12, 18, 23].map((h) => <Text key={h} style={[styles.axisT, { color: colors.textLight }]}>{h}시</Text>)}
            </View>
            <Text style={[styles.trendSub, { color: colors.textLight }]}>{rangeLabel} 구간 체크인 기준</Text>
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
                <Pressable key={g.key} onPress={() => setGran(g.key)} style={[styles.segBtn, active && { backgroundColor: colors.surface }]}>
                  <Text style={[styles.segT, { color: active ? colors.primary : colors.textSecondary }]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 데이터 표 (실제 숫자) */}
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginBottom: spacing.md }}>
            <View style={[styles.table, { borderColor: colors.border }]}>
              <View style={[styles.tr, { backgroundColor: colors.surface2 ?? colors.surfaceSecondary }]}>
                <Text style={[styles.th, styles.colPeriod, { color: colors.textSecondary }]}>기간</Text>
                {METRICS.map((m) => <Text key={String(m.key)} style={[styles.th, styles.colNum, { color: m.color }]}>{m.short}</Text>)}
              </View>
              {[...series].reverse().map((p, i) => (
                <View key={p.key} style={[styles.tr, { borderTopColor: colors.border, backgroundColor: i === 0 ? (colors.primaryBg ?? colors.surface) : colors.surface }]}>
                  <Text style={[styles.td, styles.colPeriod, { color: colors.text, fontWeight: i === 0 ? '800' : '600' }]}>{p.label}</Text>
                  {METRICS.map((m) => <Text key={String(m.key)} style={[styles.td, styles.colNum, { color: colors.text }]}>{(Number(p[m.key]) || 0).toLocaleString()}</Text>)}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* 지표별 추이 카드 */}
          {METRICS.map((m) => {
            const values = series.map((p) => Number(p[m.key]) || 0);
            const labels = series.map((p) => p.label);
            const latest = values.length ? values[values.length - 1] : 0;
            const prev = values.length > 1 ? values[values.length - 2] : 0;
            const delta = latest - prev;
            const total = values.reduce((a, b) => a + b, 0);
            const max = Math.max(0, ...values);
            return (
              <View key={String(m.key)} style={[styles.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.trendHead}>
                  <View style={[styles.trendDot, { backgroundColor: m.color }]} />
                  <Text style={[styles.trendLabel, { color: colors.text }]}>{m.label}</Text>
                  <View style={styles.trendVal}>
                    <Text style={[styles.trendLatest, { color: colors.text }]}>{latest.toLocaleString()}{m.unit}</Text>
                    {values.length > 1 && delta !== 0 && (
                      <Text style={[styles.trendDelta, { color: delta > 0 ? '#10B981' : colors.danger }]}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta).toLocaleString()}</Text>
                    )}
                  </View>
                </View>
                <TrendChart values={values} labels={labels} color={m.color} textColor={colors.textLight} />
                <Text style={[styles.trendSub, { color: colors.textLight }]}>이번 {perLabel} {latest.toLocaleString()}{m.unit} · 최대 {max.toLocaleString()}{m.unit} · 합계 {total.toLocaleString()}{m.unit}</Text>
              </View>
            );
          })}

          {(live?.todayRequests === 0 && (totals?.members ?? 0) > 0) && (
            <Text style={[styles.note, { color: colors.textLight }]}>
              ※ 동시접속 피크·API 요청수는 기록 시작 이후부터 누적돼요(그 전 기간은 0). 활동량은 기존 데이터로 계산됩니다.
            </Text>
          )}
        </ScrollView>
      )}

      {/* 드릴다운 모달 — 누구인지 명단 */}
      <Modal visible={!!whoScope} transparent animationType="fade" onRequestClose={() => setWhoScope(null)}>
        <Pressable style={styles.modalBg} onPress={() => setWhoScope(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={[styles.modalHead, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{whoTitle}{who ? ` · ${who.count}명` : ''}</Text>
              <Pressable onPress={() => setWhoScope(null)} hitSlop={10}><Icon name="close" size={18} color={colors.textSecondary} /></Pressable>
            </View>
            {whoLoading ? (
              <View style={{ padding: 28, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
            ) : !who || who.users.length === 0 ? (
              <Text style={{ color: colors.textLight, padding: 24, textAlign: 'center' }}>표시할 사람이 없어요</Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {who.users.map((u, i) => (
                  <View key={u.userId + i} style={[styles.whoRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.whoName, { color: colors.text }]} numberOfLines={1}>
                      {u.name}{u.isGuest ? <Text style={{ color: colors.textLight }}> · 게스트</Text> : null}
                    </Text>
                    {!!u.context && <Text style={[styles.whoCtx, { color: colors.textSecondary }]} numberOfLines={1}>{u.context}</Text>}
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 16, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 10, borderBottomWidth: 1 },
  topBarTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  section: { ...typography.subtitle1, fontWeight: '800' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  autoHint: { ...typography.caption, marginLeft: 'auto' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  liveCard: { flexGrow: 1, flexBasis: '30%', minWidth: 100, borderWidth: 1, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: 2 },
  liveTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveValue: { ...typography.h2, fontWeight: '800' },
  liveLabel: { ...typography.caption, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  hourChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: 64 },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: spacing.md },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  segT: { ...typography.subtitle2, fontWeight: '700' },
  // 데이터 표
  table: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center' },
  th: { ...typography.caption, fontWeight: '800', paddingVertical: 8, paddingHorizontal: 8, textAlign: 'right' },
  td: { ...typography.caption, paddingVertical: 8, paddingHorizontal: 8, textAlign: 'right' },
  colPeriod: { width: 64, textAlign: 'left' },
  colNum: { width: 58 },
  // 추이 카드
  trendCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  trendHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  trendDot: { width: 9, height: 9, borderRadius: 3 },
  trendLabel: { ...typography.subtitle2, fontWeight: '700' },
  trendVal: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginLeft: 'auto' },
  trendLatest: { ...typography.subtitle1, fontWeight: '800' },
  trendDelta: { ...typography.caption, fontWeight: '800' },
  trendSub: { ...typography.caption, marginTop: 8 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 56 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  axisT: { ...typography.caption, fontSize: 10 },
  note: { ...typography.caption, lineHeight: 17, marginTop: spacing.lg },
  // 모달
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { borderRadius: radius.lg, overflow: 'hidden', maxHeight: '80%' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  modalTitle: { ...typography.subtitle1, fontWeight: '800' },
  whoRow: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  whoName: { ...typography.body2, fontWeight: '700' },
  whoCtx: { ...typography.caption, marginTop: 1 },
});
