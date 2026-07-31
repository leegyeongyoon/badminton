import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TextInput, Pressable, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing } from '../../constants/theme';
import { BackButton } from '../../components/ui/BackButton';
import { coachApi, type CoachSettlement } from '../../services/coach';
import { paymentApi, type CoachPayout } from '../../services/payment';
import { showSuccess, showError } from '../../utils/feedback';

// ─────────────────────────────────────────────────────────────
// 코치 정산(예상) — 연결된 레슨의 이번 달 총 레슨비 → 플랫폼 수수료 공제 →
// 지급 예정액. PG(정기결제·지급대행) 연동 전까지는 입금확인 기준 예상치.
// ─────────────────────────────────────────────────────────────

export default function CoachSettlementScreen() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<CoachSettlement | null>(null);
  const [payouts, setPayouts] = useState<CoachPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 정산 계좌 등록 폼
  const [showBank, setShowBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await coachApi.settlement();
      setData(s);
      // 등록된 계좌를 폼 초기값으로 — 입력 중(폼 열림)에는 덮지 않는다.
      if (!showBank && s.bank) {
        setBankName((v) => v || s.bank!.bankName || '');
        setBankAccount((v) => v || s.bank!.bankAccount || '');
        setBankHolder((v) => v || s.bank!.bankHolder || '');
      }
      paymentApi.myPayouts().then(setPayouts).catch(() => {});
    } catch {
      /* noop */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showBank]);

  const saveBank = async () => {
    if (!bankName.trim() || !bankAccount.trim() || !bankHolder.trim()) {
      showError('은행·계좌번호·예금주를 모두 입력해 주세요');
      return;
    }
    setSavingBank(true);
    try {
      await paymentApi.setBank({ bankName: bankName.trim(), bankAccount: bankAccount.trim(), bankHolder: bankHolder.trim() });
      showSuccess('정산 계좌를 등록했어요');
      setShowBank(false);
    } catch {
      /* 토스트는 인터셉터 */
    } finally {
      setSavingBank(false);
    }
  };
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

          {/* 정산 계좌 */}
          <Pressable
            onPress={() => setShowBank((v) => !v)}
            style={[styles.bankCard, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}
          >
            <Ionicons name="business-outline" size={17} color={colors.textSecondary} />
            <Text style={[styles.bankTitle, { color: colors.text }]}>정산 계좌 {showBank ? '접기' : '등록·변경'}</Text>
            <Ionicons name={showBank ? 'chevron-up' : 'chevron-forward'} size={15} color={colors.textLight} />
          </Pressable>
          {showBank && (
            <View style={[styles.bankForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput style={[styles.bankInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]} value={bankName} onChangeText={setBankName} placeholder="은행 (예: 카카오뱅크)" placeholderTextColor={colors.textLight} maxLength={30} />
              <TextInput style={[styles.bankInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]} value={bankAccount} onChangeText={setBankAccount} placeholder="계좌번호" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={40} />
              <TextInput style={[styles.bankInput, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]} value={bankHolder} onChangeText={setBankHolder} placeholder="예금주" placeholderTextColor={colors.textLight} maxLength={20} />
              <Pressable onPress={saveBank} disabled={savingBank} style={({ pressed }) => [styles.bankSave, { backgroundColor: colors.primary }, (pressed || savingBank) && { opacity: 0.85 }]}>
                {savingBank ? <ActivityIndicator color="#fff" /> : <Text style={styles.bankSaveText}>계좌 저장</Text>}
              </Pressable>
            </View>
          )}

          {/* 지급 내역(정산 배치) */}
          {payouts.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textLight }]}>지급 내역</Text>
              {payouts.map((po) => (
                <View key={po.id} style={[styles.payoutRow, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.sm]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.payoutPeriod, { color: colors.text }]}>{po.period.replace('-', '년 ')}월 정산</Text>
                    <Text style={[styles.payoutMeta, { color: colors.textLight }]} numberOfLines={1}>
                      결제 {po.paymentCount}건 · 수수료 −{po.feeAmount.toLocaleString()}원{po.bankSnapshot ? ` · ${po.bankSnapshot}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[styles.payoutAmount, { color: colors.text }]}>{po.payoutAmount.toLocaleString()}원</Text>
                    <View style={[styles.payoutState, { backgroundColor: (po.status === 'PAID' ? colors.secondary : colors.warning) + '16' }]}>
                      <Text style={[styles.payoutStateText, { color: po.status === 'PAID' ? colors.secondary : colors.warning }]}>
                        {po.status === 'PAID' ? `지급 완료${po.paidAt ? ` · ${new Date(po.paidAt).toLocaleDateString()}` : ''}` : '지급 대기'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </>
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
  bankCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: spacing.lg },
  bankTitle: { fontSize: 14, fontWeight: '800', flex: 1 },
  bankForm: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: spacing.lg, gap: spacing.sm },
  bankInput: { fontSize: 13.5, fontWeight: '600', borderWidth: 1, borderRadius: 11, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'web' ? 10 : 9 },
  bankSave: { paddingVertical: 12, borderRadius: 11, alignItems: 'center' },
  bankSaveText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  sectionLabel: { fontSize: 12, fontWeight: '800', marginTop: spacing.xs, marginLeft: 4 },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  payoutPeriod: { fontSize: 14, fontWeight: '800' },
  payoutMeta: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  payoutAmount: { fontSize: 15, fontWeight: '900' },
  payoutState: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  payoutStateText: { fontSize: 10.5, fontWeight: '800' },
  noticeBox: { flexDirection: 'row', gap: 6, borderWidth: 1, borderRadius: 12, padding: spacing.md, alignItems: 'flex-start' },
  noticeText: { fontSize: 11.5, fontWeight: '600', lineHeight: 16, flex: 1 },
});
