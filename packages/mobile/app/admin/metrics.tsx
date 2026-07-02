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

// 추이 선택 지표 + 표 컬럼 정의.
const ACTIVITY: { key: keyof MetricPoint; label: string; color: string; unit: string }[] = [
  { key: 'dau', label: 'DAU', color: '#10B981', unit: '명' },
  { key: 'checkins', label: '체크인', color: '#0EA5E9', unit: '건' },
  { key: 'newUsers', label: '신규가입', color: '#F59E0B', unit: '명' },
  { key: 'sessions', label: '정모', color: '#EF4444', unit: '개' },
  { key: 'games', label: '게임', color: '#EC4899', unit: '판' },
  { key: 'peakConnections', label: '접속피크', color: '#14B8A6', unit: '' },
  { key: 'requestCount', label: 'API요청', color: '#8B5CF6', unit: '' },
];
const TABLE_COLS: { key: keyof MetricPoint; short: string }[] = [
  { key: 'cumulativeMembers', short: '회원' },
  { key: 'dau', short: 'DAU' },
  { key: 'checkins', short: '체크인' },
  { key: 'newUsers', short: '신규' },
  { key: 'sessions', short: '정모' },
  { key: 'games', short: '게임' },
  { key: 'peakConnections', short: '피크' },
  { key: 'requestCount', short: '요청' },
];

// 격자선 + 막대 위 값 라벨 + 탭 툴팁 + 희소 x라벨 있는 폴리시드 막대 차트.
// showValues: 막대 위에 숫자를 직접 표시(0은 생략). 막대가 아주 많으면(시간대 24) 끔.
function TrendChart({ values, labels, color, unit, emphasizeIdx, height = 150, showValues = true }: { values: number[]; labels: string[]; color: string; unit: string; emphasizeIdx?: number; height?: number; showValues?: boolean }) {
  const { colors } = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  const n = values.length;
  const max = Math.max(1, ...values);
  const shown = sel ?? emphasizeIdx ?? n - 1;
  const withLabels = showValues && n <= 16; // 너무 많으면 라벨 생략
  const barMax = height - (withLabels ? 20 : 8); // 값 라벨 자리 확보
  return (
    <View>
      <View style={styles.chartHead}>
        <Text style={[styles.chartHeadLabel, { color: colors.textSecondary }]}>{labels[shown] ?? ''}</Text>
        <Text style={[styles.chartHeadVal, { color }]}>{(values[shown] ?? 0).toLocaleString()}{unit}</Text>
      </View>
      <View style={{ height, position: 'relative' }}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={[styles.gridLine, { bottom: (i / 4) * height, borderBottomColor: colors.border }]} />
        ))}
        <Text style={[styles.yMax, { color: colors.textLight }]}>{max.toLocaleString()}</Text>
        <View style={[styles.barsRow, { gap: n > 18 ? 1 : 3 }]}>
          {values.map((v, i) => {
            const h = Math.max(2, Math.round((v / max) * barMax));
            const on = i === shown;
            return (
              <Pressable key={i} onPress={() => setSel(sel === i ? null : i)} style={styles.barPress}>
                {withLabels && v > 0 && (
                  <Text style={[styles.barVal, { color: on ? color : colors.textSecondary, fontWeight: on ? '800' : '600' }]} numberOfLines={1}>
                    {v.toLocaleString()}
                  </Text>
                )}
                <View style={{ width: '82%', height: h, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color, opacity: on ? 1 : 0.4 }} />
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisT, { color: colors.textLight }]}>{labels[0]}</Text>
        {n > 2 && <Text style={[styles.axisT, { color: colors.textLight }]}>{labels[Math.floor((n - 1) / 2)]}</Text>}
        <Text style={[styles.axisT, { color: colors.textLight }]}>{labels[n - 1]}</Text>
      </View>
    </View>
  );
}

export default function AdminMetricsScreen() {
  const { colors } = useTheme();
  const [gran, setGran] = useState<MetricGranularity>('day');
  const [metricKey, setMetricKey] = useState<keyof MetricPoint>('dau');
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errored, setErrored] = useState(false);

  const [whoScope, setWhoScope] = useState<WhoScope | null>(null);
  const [who, setWho] = useState<WhoResponse | null>(null);
  const [whoLoading, setWhoLoading] = useState(false);

  const load = useCallback(async (g: MetricGranularity) => {
    try {
      const m = await adminStatsApi.getMetrics(g);
      setData(m); setErrored(false);
    } catch { setErrored(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(gran);
    const t = setInterval(() => load(gran), 15000);
    return () => clearInterval(t);
  }, [load, gran]);

  const openWho = useCallback(async (scope: WhoScope) => {
    setWhoScope(scope); setWho(null); setWhoLoading(true);
    try { setWho(await adminStatsApi.getWho(scope)); } catch { setWho(null); } finally { setWhoLoading(false); }
  }, []);

  const live = data?.live;
  const totals = data?.totals;
  const series = data?.series ?? [];
  const hourly = data?.hourly ?? [];
  const labels = series.map((p) => p.label);
  const rangeLabel = series.length ? `${series[0].label} ~ ${series[series.length - 1].label}` : '';
  const peakHour = hourly.length ? hourly.indexOf(Math.max(...hourly)) : -1;
  const metric = ACTIVITY.find((m) => m.key === metricKey) ?? ACTIVITY[0];

  // 회원 성장
  const growthVals = series.map((p) => p.cumulativeMembers);
  const memberDelta = growthVals.length > 1 ? growthVals[growthVals.length - 1] - growthVals[0] : 0;

  const StatCard = ({ label, value, accent, onPress }: { label: string; value: number | string; accent?: boolean; onPress?: () => void }) => (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [styles.liveCard, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && onPress ? { opacity: 0.6 } : null]}>
      <View style={styles.liveTop}>
        <Text style={[styles.liveValue, { color: accent ? colors.primary : colors.text }]} numberOfLines={1}>{value}</Text>
        {onPress && <Icon name="chevronRight" size={14} color={colors.textLight} />}
      </View>
      <Text style={[styles.liveLabel, { color: colors.textSecondary }]} numberOfLines={1}>{label}{onPress ? ' ›' : ''}</Text>
    </Pressable>
  );

  const Card = ({ children, title, hint }: { children: React.ReactNode; title: string; hint?: string }) => (
    <View style={[styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardTitleRow}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
        {!!hint && <Text style={[styles.autoHint, { color: colors.textLight }]}>{hint}</Text>}
      </View>
      {children}
    </View>
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
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
          refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(gran); }} />}>
          {/* 실시간 */}
          <View style={styles.sectionRow}>
            <Text style={[styles.section, { color: colors.text }]}>실시간</Text>
            <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.autoHint, { color: colors.textLight }]}>탭하면 명단 · 15초 갱신</Text>
          </View>
          <View style={styles.grid}>
            <StatCard label="현재 접속" value={live?.currentConnections ?? 0} accent onPress={() => openWho('online')} />
            <StatCard label="지금 체크인" value={live?.checkedInNow ?? 0} onPress={() => openWho('checkedin')} />
            <StatCard label="오늘 DAU" value={live?.todayDau ?? 0} onPress={() => openWho('today')} />
            <StatCard label="진행 중 정모" value={live?.activeSessions ?? 0} />
            <StatCard label="오늘 피크" value={live?.todayPeakConnections ?? 0} />
            <StatCard label="오늘 요청수" value={(live?.todayRequests ?? 0).toLocaleString()} />
          </View>

          {/* 누적 — '회원'=앱에 직접 가입한 실회원(게스트·명단추가 제외) */}
          <Text style={[styles.section, { color: colors.text, marginTop: spacing.xl }]}>누적</Text>
          <View style={styles.grid}>
            <StatCard label="가입 회원" value={(totals?.members ?? 0).toLocaleString()} accent />
            <StatCard label="명단·기타" value={(totals?.managed ?? 0).toLocaleString()} />
            <StatCard label="게스트(누적)" value={(totals?.guests ?? 0).toLocaleString()} />
            <StatCard label="모임" value={totals?.clubs ?? 0} />
            <StatCard label="시설" value={totals?.facilities ?? 0} />
          </View>
          <Text style={[styles.subNote, { color: colors.textLight }]}>가입 회원 = 실제 로그인 수단(비번·카카오·구글) 있는 계정 · 명단·기타 = 운영자 명단추가 등 로그인 없는 계정 · 게스트 = 임시 참여</Text>

          {/* 기간 전환 */}
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

          {/* 기간별 숫자 표 — 차트보다 먼저, 실제 값을 크게. 가로 스크롤. */}
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>기간별 숫자</Text>
            <Text style={[styles.autoHint, { color: colors.textLight }]}>← 옆으로 스크롤</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginBottom: spacing.lg }}>
            <View style={[styles.table, { borderColor: colors.border }]}>
              <View style={[styles.tr, { backgroundColor: colors.surface2 ?? colors.surfaceSecondary }]}>
                <Text style={[styles.th, styles.colPeriod, { color: colors.textSecondary }]}>기간</Text>
                {TABLE_COLS.map((c) => <Text key={String(c.key)} style={[styles.th, styles.colNum, { color: colors.textSecondary }]}>{c.short}</Text>)}
              </View>
              {[...series].reverse().map((p, i) => (
                <View key={p.key} style={[styles.tr, { borderTopColor: colors.border, backgroundColor: i === 0 ? (colors.primaryBg ?? colors.surface) : colors.surface }]}>
                  <Text style={[styles.td, styles.colPeriod, { color: colors.text, fontWeight: i === 0 ? '800' : '600' }]}>{p.label}</Text>
                  {TABLE_COLS.map((c) => <Text key={String(c.key)} style={[styles.td, styles.colNum, { color: colors.text, fontWeight: i === 0 ? '800' : '400' }]}>{(Number(p[c.key]) || 0).toLocaleString()}</Text>)}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* 가입 회원 성장(누적) — 히어로 */}
          <Card title="가입 회원 성장 (누적)" hint={memberDelta ? `기간 +${memberDelta.toLocaleString()}명` : ''}>
            <TrendChart values={growthVals} labels={labels} color={colors.primary} unit="명" height={168} />
          </Card>

          {/* 활동 추이 — 지표 선택 + 큰 차트 */}
          <Card title="활동 추이">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }} contentContainerStyle={{ gap: 6 }}>
              {ACTIVITY.map((m) => {
                const on = m.key === metricKey;
                return (
                  <Pressable key={String(m.key)} onPress={() => setMetricKey(m.key)}
                    style={[styles.chip, { borderColor: on ? m.color : colors.border, backgroundColor: on ? m.color : 'transparent' }]}>
                    <Text style={[styles.chipT, { color: on ? '#fff' : colors.textSecondary }]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TrendChart values={series.map((p) => Number(p[metric.key]) || 0)} labels={labels} color={metric.color} unit={metric.unit} height={168} />
          </Card>

          {/* 시간대별 피크 */}
          <Card title="시간대별 피크" hint={peakHour >= 0 ? `가장 붐빔 ${peakHour}시` : ''}>
            <TrendChart values={hourly} labels={hourly.map((_, h) => `${h}시`)} color="#F97316" unit="건" emphasizeIdx={peakHour >= 0 ? peakHour : undefined} height={120} showValues={false} />
          </Card>

          {(live?.todayRequests === 0 && (totals?.members ?? 0) > 0) && (
            <Text style={[styles.note, { color: colors.textLight }]}>
              ※ 접속 피크·API 요청수는 기록 시작 이후부터 쌓여요(그 전 기간은 0). 활동량·회원 성장은 기존 데이터로 계산됩니다.
            </Text>
          )}
        </ScrollView>
      )}

      {/* 드릴다운 명단 모달 */}
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
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: spacing.md },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  segT: { ...typography.subtitle2, fontWeight: '700' },
  // big card
  bigCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  cardTitle: { ...typography.subtitle1, fontWeight: '800' },
  // chart
  chartHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 },
  chartHeadLabel: { ...typography.caption, fontWeight: '600' },
  chartHeadVal: { ...typography.h3, fontWeight: '800' },
  gridLine: { position: 'absolute', left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  yMax: { position: 'absolute', top: -3, left: 0, fontSize: 10 },
  barsRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  barPress: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barVal: { fontSize: 9, marginBottom: 2, textAlign: 'center' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisT: { ...typography.caption, fontSize: 10 },
  // chips
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1.5 },
  chipT: { ...typography.caption, fontWeight: '800' },
  // table
  table: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center' },
  th: { ...typography.caption, fontWeight: '800', paddingVertical: 8, paddingHorizontal: 6, textAlign: 'right' },
  td: { ...typography.caption, paddingVertical: 8, paddingHorizontal: 6, textAlign: 'right' },
  colPeriod: { width: 60, textAlign: 'left', paddingLeft: 10 },
  colNum: { width: 52 },
  note: { ...typography.caption, lineHeight: 17, marginTop: spacing.md },
  subNote: { ...typography.caption, fontSize: 11, lineHeight: 15, marginTop: 6 },
  // modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { borderRadius: radius.lg, overflow: 'hidden', maxHeight: '80%' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  modalTitle: { ...typography.subtitle1, fontWeight: '800' },
  whoRow: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  whoName: { ...typography.body2, fontWeight: '700' },
  whoCtx: { ...typography.caption, marginTop: 1 },
});
