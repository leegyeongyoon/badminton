import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, type CoachSettlement } from '../../services/coach';

// ─────────────────────────────────────────────────────────────
// 코치 정산(예상) — 연결된 레슨의 이번 달 총 레슨비 → 플랫폼 수수료 공제 →
// 지급 예정액. PG(정기결제·지급대행) 연동 전까지는 입금확인 기준 예상치.
// ─────────────────────────────────────────────────────────────

export default function CoachSettlementScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<CoachSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await coachApi.settlement());
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pct = data ? Math.round(data.feeRate * 100) : 10;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.border, paddingTop: insets.top + spacing.sm }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.text }]}>정산 예정</Text>
      </View>

      {loading || !data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* 합계 카드 */}
          <View style={[styles.totalCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
            <Text style={[styles.totalLabel, { color: colors.textLight }]}>이번 달 지급 예정액</Text>
            <Text style={[styles.totalPayout, { color: colors.text }]}>{data.totalPayout.toLocaleString()}원</Text>
            <View style={[styles.totalBreak, { borderTopColor: colors.border }]}>
              <View style={styles.breakRow}>
                <Text style={[styles.breakLabel, { color: colors.textSecondary }]}>총 레슨비</Text>
                <Text style={[styles.breakValue, { color: colors.text }]}>{data.totalGross.toLocaleString()}원</Text>
              </View>
              <View style={styles.breakRow}>
                <Text style={[styles.breakLabel, { color: colors.textSecondary }]}>플랫폼 수수료 ({pct}%)</Text>
                <Text style={[styles.breakValue, { color: colors.danger }]}>−{data.totalPlatformFee.toLocaleString()}원</Text>
              </View>
            </View>
          </View>

          {/* 레슨별 내역 */}
          {data.lessons.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="cash-outline" size={32} color={colors.textLight} />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                연결된 레슨이 생기면 여기서 정산을 확인해요
              </Text>
            </View>
          ) : (
            data.lessons.map((b) => (
              <View key={b.offerId} style={[styles.lessonCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                <View style={styles.lessonHead}>
                  <Text style={[styles.lessonClub, { color: colors.text }]} numberOfLines={1}>{b.clubName}</Text>
                  <Text style={[styles.lessonPayout, { color: colors.text }]}>{b.coachPayout.toLocaleString()}원</Text>
                </View>
                <Text style={[styles.lessonMeta, { color: colors.textSecondary }]}>
                  {b.summary}{b.fee != null ? ` · 월 ${b.fee.toLocaleString()}원` : ''}
                </Text>
                <Text style={[styles.lessonSub, { color: colors.textLight }]}>
                  수강 {b.activeStudents}명 · 수납 {b.paidCount}/{b.activeStudents} · 수수료 −{b.platformFee.toLocaleString()}원
                </Text>
              </View>
            ))
          )}

          <View style={[styles.noticeBox, { backgroundColor: colors.warning + '10', borderColor: colors.warning + '40' }]}>
            <Ionicons name="information-circle-outline" size={15} color={colors.warning} />
            <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
              플랫폼 자동 정산(카드 정기결제·지급대행)은 준비 중이에요. 지금은 운영진의 입금확인 기준 예상치입니다.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.subtitle1, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  totalCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: spacing.xl, alignItems: 'center' },
  totalLabel: { fontSize: 12.5, fontWeight: '700' },
  totalPayout: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5, marginTop: 6 },
  totalBreak: { width: '100%', borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.lg, paddingTop: spacing.md, gap: 6 },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakLabel: { fontSize: 13, fontWeight: '600' },
  breakValue: { fontSize: 13.5, fontWeight: '800' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  lessonCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  lessonHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lessonClub: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  lessonPayout: { fontSize: 15.5, fontWeight: '900' },
  lessonMeta: { fontSize: 12.5, fontWeight: '700', marginTop: 4 },
  lessonSub: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  noticeBox: { flexDirection: 'row', gap: 6, borderWidth: 1, borderRadius: 12, padding: spacing.md, alignItems: 'flex-start' },
  noticeText: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, flex: 1 },
});
