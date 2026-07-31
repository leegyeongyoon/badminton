import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { paymentApi, cardBrandLabel, type PaymentHistoryRow } from '../../services/payment';

// 내 결제 내역 — 월별 그룹, 상태 칩(완료/실패/취소).

const STATUS_LABEL: Record<string, string> = { PAID: '결제 완료', FAILED: '결제 실패', CANCELLED: '취소됨' };

export default function PaymentHistory() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await paymentApi.history());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byPeriod = rows.reduce<Record<string, PaymentHistoryRow[]>>((acc, r) => {
    (acc[r.period] = acc[r.period] ?? []).push(r);
    return acc;
  }, {});
  const periods = Object.keys(byPeriod).sort().reverse();

  const statusColor = (s: string) =>
    s === 'PAID' ? colors.secondary : s === 'FAILED' ? colors.danger : colors.textLight;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>결제 내역</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {periods.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="receipt-outline" size={34} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>결제 내역이 없어요</Text>
            </View>
          ) : (
            periods.map((period) => (
              <View key={period} style={{ marginBottom: spacing.lg }}>
                <Text style={[styles.periodLabel, { color: colors.textLight }]}>
                  {period.replace('-', '년 ')}월
                </Text>
                {byPeriod[period].map((r) => (
                  <View key={r.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.orderName, { color: colors.text }]} numberOfLines={1}>
                        {r.orderName ?? '레슨비'}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textLight }]} numberOfLines={1}>
                        {new Date(r.paidAt).toLocaleDateString()} {r.cardBrand ? `· ${cardBrandLabel(r.cardBrand)} ****${r.cardLast4}` : ''}
                      </Text>
                      {r.status === 'FAILED' && !!r.failReason && (
                        <Text style={[styles.failReason, { color: colors.danger }]} numberOfLines={1}>{r.failReason}</Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[styles.amount, { color: r.status === 'CANCELLED' ? colors.textLight : colors.text, textDecorationLine: r.status === 'CANCELLED' ? 'line-through' : 'none' }]}>
                        {r.amount.toLocaleString()}원
                      </Text>
                      <View style={[styles.stateChip, { backgroundColor: statusColor(r.status) + '16' }]}>
                        <Text style={[styles.stateText, { color: statusColor(r.status) }]}>{STATUS_LABEL[r.status] ?? r.status}</Text>
                      </View>
                    </View>
                  </View>
                ))}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyTitle: { ...typography.subtitle1 },
  periodLabel: { fontSize: 12.5, fontWeight: '800', marginBottom: spacing.sm, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.sm },
  orderName: { fontSize: 14.5, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  failReason: { fontSize: 11.5, fontWeight: '700', marginTop: 3 },
  amount: { fontSize: 15, fontWeight: '900' },
  stateChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  stateText: { fontSize: 10.5, fontWeight: '800' },
});
