import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { typography, spacing, radius } from '../constants/theme';
import { copyToClipboard } from '../utils/clipboard';
import api from '../services/api';

// ─────────────────────────────────────────────────────────────
// 레슨비 납부 페이지(공개, 무설치·무로그인) — /lesson-pay?t=<token>
// 수강생: 이번 달 레슨비·계좌 확인 → 이체 → 자기 이름 선택 → "입금했어요".
// 반장·반원 누구나 같은 링크로 납부 현황을 본다. 확인(확정)은 운영진 앱에서.
// 돈은 여기로 흐르지 않는다 — 기록만 한다.
// ─────────────────────────────────────────────────────────────

interface PayView {
  offerId: string;
  clubName: string;
  coachName: string;
  summary: string;
  period: string; // "YYYY-MM"
  fee: number | null;
  accountInfo: string | null;
  mode: 'pay' | 'manage'; // manage = 반장 링크(확인/해제 가능)
  rows: { applicationId: string; name: string; status: 'UNPAID' | 'REPORTED' | 'CONFIRMED' }[];
}

const APP_STORE_URL = 'https://apps.apple.com/app/id6788656869';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.gylee.badminton';

const STATUS_META: Record<PayView['rows'][number]['status'], { label: string; icon: string }> = {
  CONFIRMED: { label: '확인 완료', icon: 'checkmark-circle' },
  REPORTED: { label: '확인 대기', icon: 'time-outline' },
  UNPAID: { label: '미납', icon: 'ellipse-outline' },
};

export default function LessonPay() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<PayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // applicationId
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!t) {
      setError('잘못된 링크예요.');
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<PayView>(`/lesson-pay/${t}`, { _silent: true } as any);
      setView(data);
      setError(null);
    } catch {
      setError('납부 페이지를 찾을 수 없어요. 링크를 다시 확인해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const report = async () => {
    if (!t || !selected || busy) return;
    setBusy(true);
    try {
      await api.post(`/lesson-pay/${t}/report`, { applicationId: selected }, { _silent: true } as any);
      setSelected(null);
      await load();
    } catch {
      setError('신고에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  // 신고 취소(실수 복구) — REPORTED 상태만 서버에서 되돌려준다.
  const cancelReport = async () => {
    if (!t || !selected || busy) return;
    setBusy(true);
    try {
      await api.post(`/lesson-pay/${t}/report/cancel`, { applicationId: selected }, { _silent: true } as any);
      setSelected(null);
      await load();
    } catch {
      setError('취소에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  // 반장 모드: 확인/해제 원터치.
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const manageToggle = async (applicationId: string, status: string) => {
    if (!t || busyRowId) return;
    setBusyRowId(applicationId);
    try {
      if (status === 'CONFIRMED') {
        await api.delete(`/lesson-pay/${t}/confirm`, { data: { applicationId }, _silent: true } as any);
      } else {
        await api.post(`/lesson-pay/${t}/confirm`, { applicationId }, { _silent: true } as any);
      }
      await load();
    } catch {
      setError('처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyRowId(null);
    }
  };

  const copyAccount = async () => {
    if (!view?.accountInfo) return;
    const ok = await copyToClipboard(view.accountInfo);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const [year, month] = view ? view.period.split('-') : ['', ''];
  const selectedRow = view?.rows.find((r) => r.applicationId === selected);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl, paddingHorizontal: spacing.lg }}
    >
      {loading ? (
        <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />
      ) : error && !view ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[typography.body1, { color: colors.textSecondary, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : view ? (
        <>
          {/* 헤더 — 반 정보 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.club, { color: colors.textSecondary }]}>{view.clubName}</Text>
            {view.mode === 'manage' && (
              <View style={[styles.manageBadge, { backgroundColor: colors.primaryBg }]}>
                <Text style={[styles.manageBadgeText, { color: colors.primary }]}>반장 모드</Text>
              </View>
            )}
          </View>
          <Text style={[styles.title, { color: colors.text }]}>
            {view.coachName} 코치 레슨 · {Number(month)}월 레슨비
          </Text>
          <Text style={[typography.body2, { color: colors.textSecondary, marginTop: 2 }]}>{view.summary}</Text>

          {/* 금액·계좌 */}
          <View style={[styles.card, shadows.sm, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: spacing.lg }]}>
            {view.fee != null && (
              <View style={styles.rowBetween}>
                <Text style={[typography.body2, { color: colors.textSecondary }]}>월 레슨비</Text>
                <Text style={[styles.fee, { color: colors.text }]}>{view.fee.toLocaleString()}원</Text>
              </View>
            )}
            {view.accountInfo ? (
              <Pressable
                onPress={copyAccount}
                style={[styles.accountBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typography.caption, { color: colors.textLight }]}>입금 계좌 (탭하면 복사)</Text>
                  <Text style={[typography.body1, { color: colors.text, marginTop: 2 }]}>{view.accountInfo}</Text>
                </View>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? colors.primary : colors.textLight} />
              </Pressable>
            ) : (
              <Text style={[typography.caption, { color: colors.textLight, marginTop: spacing.sm }]}>
                입금 계좌는 반장님께 확인해 주세요.
              </Text>
            )}
          </View>

          {/* 명단 — 자기 이름 선택 */}
          <Text style={[styles.section, { color: colors.text }]}>
            {year}년 {Number(month)}월 납부 현황
          </Text>
          <Text style={[typography.caption, { color: colors.textLight, marginBottom: spacing.sm }]}>
            {view.mode === 'manage'
              ? '입금이 확인된 반원의 [입금 확인]을 눌러주세요. 이 링크는 반장님 전용이에요 — 단톡에 공유하지 마세요.'
              : '입금하셨다면 본인 이름을 눌러 알려주세요 — 반장님 확인 후 완료돼요. 잘못 눌렀다면 다시 눌러 취소할 수 있어요.'}
          </Text>
          <View style={[styles.card, shadows.sm, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 4 }]}>
            {view.rows.length === 0 && (
              <Text style={[typography.body2, { color: colors.textLight, padding: spacing.md }]}>아직 등록된 수강생이 없어요.</Text>
            )}
            {view.rows.map((r, i) => {
              const meta = STATUS_META[r.status];
              const isSel = selected === r.applicationId;
              const tappable = view.mode === 'pay' && r.status !== 'CONFIRMED';
              const rowBusy = busyRowId === r.applicationId;
              return (
                <Pressable
                  key={r.applicationId}
                  onPress={() => tappable && setSelected(isSel ? null : r.applicationId)}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    isSel && { backgroundColor: colors.primaryBg },
                  ]}
                >
                  <Text style={[typography.body1, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Ionicons
                    name={meta.icon as any}
                    size={16}
                    color={r.status === 'CONFIRMED' ? colors.primary : r.status === 'REPORTED' ? colors.warning : colors.textLight}
                  />
                  <Text
                    style={[
                      typography.caption,
                      { color: r.status === 'CONFIRMED' ? colors.primary : r.status === 'REPORTED' ? colors.warning : colors.textLight },
                    ]}
                  >
                    {meta.label}
                  </Text>
                  {view.mode === 'manage' && (
                    <Pressable
                      onPress={() => manageToggle(r.applicationId, r.status)}
                      disabled={rowBusy}
                      style={[
                        styles.manageBtn,
                        r.status === 'CONFIRMED'
                          ? { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
                          : { backgroundColor: colors.primary },
                        rowBusy && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={[styles.manageBtnText, r.status === 'CONFIRMED' && { color: colors.textSecondary }]}>
                        {r.status === 'CONFIRMED' ? '해제' : '입금 확인'}
                      </Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* 신고/취소 버튼 (반원 모드) */}
          {selectedRow && view.mode === 'pay' && (
            <Pressable
              onPress={selectedRow.status === 'REPORTED' ? cancelReport : report}
              disabled={busy}
              style={[
                styles.cta,
                selectedRow.status === 'REPORTED'
                  ? { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
                  : { backgroundColor: colors.primary },
                { opacity: busy ? 0.6 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={selectedRow.status === 'REPORTED' ? colors.text : '#fff'} />
              ) : (
                <Text style={[styles.ctaText, selectedRow.status === 'REPORTED' && { color: colors.textSecondary }]}>
                  {selectedRow.status === 'REPORTED' ? `${selectedRow.name} — 신고 취소` : `${selectedRow.name} — 입금했어요`}
                </Text>
              )}
            </Pressable>
          )}
          {error && <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm, textAlign: 'center' }]}>{error}</Text>}

          <Pressable onPress={load} style={styles.refresh}>
            <Ionicons name="refresh" size={14} color={colors.textLight} />
            <Text style={[typography.caption, { color: colors.textLight }]}> 새로고침</Text>
          </Pressable>

          <Text style={[typography.caption, { color: colors.textLight, textAlign: 'center', marginTop: spacing.xl }]}>
            돈은 이 페이지로 오가지 않아요 — 이체는 계좌로, 여기서는 확인만 해요.
          </Text>

          {/* 콕고 푸터 — 브랜드 + 앱 안내 */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerBrand, { color: colors.text }]}>🏸 콕고</Text>
            <Text style={[typography.caption, { color: colors.textLight, textAlign: 'center' }]}>
              배드민턴 모임 운영 — 체크인·게임 편성·회비·레슨비까지
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
              <Text
                style={[typography.caption, { color: colors.primary, fontWeight: '700' }]}
                onPress={() => Linking.openURL(APP_STORE_URL).catch(() => {})}
              >
                App Store
              </Text>
              <Text
                style={[typography.caption, { color: colors.primary, fontWeight: '700' }]}
                onPress={() => Linking.openURL(PLAY_STORE_URL).catch(() => {})}
              >
                Google Play
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  club: { fontSize: 13, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fee: { fontSize: 18, fontWeight: '700' },
  accountBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md,
  },
  section: { fontSize: 16, fontWeight: '700', marginTop: spacing.xl, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: spacing.md },
  cta: { marginTop: spacing.lg, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  refresh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, padding: spacing.sm },
  manageBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  manageBadgeText: { fontSize: 11, fontWeight: '800' },
  manageBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, marginLeft: 6 },
  manageBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  footer: { alignItems: 'center', gap: 4, marginTop: spacing.xxl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  footerBrand: { fontSize: 14, fontWeight: '800' },
});
