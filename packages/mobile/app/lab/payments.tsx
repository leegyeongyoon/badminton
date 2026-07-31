import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { paymentApi, type PlatformSummary } from '../../services/payment';
import { showSuccess } from '../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 플랫폼 정산 콘솔(최고관리자) — 월 수납·수수료 수익·코치 배치 관리.
//  [자동청구 실행] → [월 마감(배치 생성)] → 배치별 [지급 실행]
// 실서비스에선 크론·지급대행으로 자동화될 운영 동작을 수동 버튼으로 제공.
// ─────────────────────────────────────────────────────────────

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PlatformPayments() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await paymentApi.platformSummary(period));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runBilling = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await paymentApi.runBilling(period);
      showSuccess(`자동청구 완료 — 성공 ${r.charged} · 실패 ${r.failed} · 카드없음 ${r.skippedNoCard}`);
      await load();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const closeMonth = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await paymentApi.closeSettlement(period);
      const unlinked = r.unlinkedCount > 0 ? ` · 코치 미연결 수납 ${r.unlinkedCount}건(${r.unlinkedAmount.toLocaleString()}원) 제외` : '';
      showSuccess(`월 마감 — 코치 배치 ${r.batches.length}건 생성/갱신${unlinked}`);
      await load();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const pay = async (payoutId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await paymentApi.executePayout(payoutId);
      showSuccess(`${name} 코치에게 지급 완료`);
      await load();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>플랫폼 정산 콘솔</Text>
      </View>

      {/* 월 이동 */}
      <View style={[styles.periodBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, -1))} hitSlop={8}><Ionicons name="chevron-back" size={19} color={colors.text} /></Pressable>
        <Text style={[styles.periodText, { color: colors.text }]}>{period.replace('-', '년 ')}월</Text>
        <Pressable onPress={() => setPeriod((p) => shiftPeriod(p, 1))} hitSlop={8}><Ionicons name="chevron-forward" size={19} color={colors.text} /></Pressable>
      </View>

      {loading || !data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* 요약 */}
          <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>수납 총액 ({data.paymentCount}건)</Text>
              <Text style={[styles.sumValue, { color: colors.text }]}>{data.grossPaid.toLocaleString()}원</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>플랫폼 수수료 수익</Text>
              <Text style={[styles.sumValue, { color: colors.primary }]}>{data.feeRevenue.toLocaleString()}원</Text>
            </View>
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>결제 실패</Text>
              <Text style={[styles.sumValue, { color: data.failedCount > 0 ? colors.danger : colors.textLight }]}>{data.failedCount}건</Text>
            </View>
            <View style={[styles.sumDivider, { backgroundColor: colors.border }]} />
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>코치 지급 대기 / 완료</Text>
              <Text style={[styles.sumValue, { color: colors.text }]}>
                {data.payoutPending.toLocaleString()} / {data.payoutPaid.toLocaleString()}원
              </Text>
            </View>
          </View>

          {/* 운영 액션 */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable onPress={runBilling} disabled={busy} style={({ pressed }) => [styles.opBtn, { backgroundColor: colors.surface, borderColor: colors.border }, (pressed || busy) && { opacity: 0.7 }]}>
              <Ionicons name="refresh-outline" size={15} color={colors.textSecondary} />
              <Text style={[styles.opBtnText, { color: colors.text }]}>자동청구 실행</Text>
            </Pressable>
            <Pressable onPress={closeMonth} disabled={busy} style={({ pressed }) => [styles.opBtn, { backgroundColor: colors.primary, borderColor: colors.primary }, (pressed || busy) && { opacity: 0.85 }]}>
              <Ionicons name="lock-closed-outline" size={15} color="#fff" />
              <Text style={[styles.opBtnText, { color: '#fff' }]}>월 마감(배치 생성)</Text>
            </Pressable>
          </View>

          {/* 코치 배치 */}
          {data.batches.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="albums-outline" size={30} color={colors.textLight} />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>이 달의 정산 배치가 없어요 — 월 마감을 실행해 보세요</Text>
            </View>
          ) : (
            data.batches.map((b) => (
              <View key={b.id} style={[styles.batchRow, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.batchName, { color: colors.text }]}>{b.coachName} 코치</Text>
                  <Text style={[styles.batchMeta, { color: colors.textLight }]} numberOfLines={1}>
                    결제 {b.paymentCount}건 · 수수료 −{b.feeAmount.toLocaleString()}원
                    {b.bankSnapshot ? ` · ${b.bankSnapshot}` : ' · ⚠️ 계좌 미등록'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                  <Text style={[styles.batchAmount, { color: colors.text }]}>{b.payoutAmount.toLocaleString()}원</Text>
                  {b.status === 'PAID' ? (
                    <View style={[styles.paidChip, { backgroundColor: colors.secondary + '16' }]}>
                      <Text style={[styles.paidChipText, { color: colors.secondary }]}>지급 완료</Text>
                    </View>
                  ) : (
                    <Pressable onPress={() => pay(b.id, b.coachName)} disabled={busy} style={[styles.payBtn, { backgroundColor: colors.secondary }]}>
                      <Text style={styles.payBtnText}>지급 실행</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  periodBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  periodText: { fontSize: 15.5, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLabel: { fontSize: 13, fontWeight: '600' },
  sumValue: { fontSize: 14, fontWeight: '900' },
  sumDivider: { height: StyleSheet.hairlineWidth },
  opBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 12, paddingVertical: 12 },
  opBtnText: { fontSize: 13, fontWeight: '800' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  batchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  batchName: { fontSize: 14.5, fontWeight: '800' },
  batchMeta: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  batchAmount: { fontSize: 15, fontWeight: '900' },
  paidChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  paidChipText: { fontSize: 11, fontWeight: '800' },
  payBtn: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 9 },
  payBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
