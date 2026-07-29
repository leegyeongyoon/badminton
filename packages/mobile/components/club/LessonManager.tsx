import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Switch, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { showSuccess, showError } from '../../utils/feedback';
import type { LessonApi, LessonOffer, LessonApplicationRow } from '../../services/lab';

// ─────────────────────────────────────────────────────────────
// 레슨 관리(공용) — 실험실(최고관리자)과 모임 관리(운영진) 양쪽에서
// LessonApi 어댑터만 갈아끼워 쓰는 화면. 레슨 상품 개설 + 신청 확정.
// ─────────────────────────────────────────────────────────────

export interface LessonClub {
  id: string;
  name: string;
}

const DAYS = [
  { day: 1, label: '월' }, { day: 2, label: '화' }, { day: 3, label: '수' },
  { day: 4, label: '목' }, { day: 5, label: '금' }, { day: 6, label: '토' }, { day: 0, label: '일' },
];
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const num = (s: string): number | null => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n <= 0 ? null : n;
};

const confirmAsk = (title: string, message: string, onOk: () => void) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n${message}`)) onOk();
  } else {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      { text: '확인', style: 'destructive', onPress: onOk },
    ]);
  }
};

export function LessonManager({ clubs, api }: { clubs: LessonClub[]; api: LessonApi }) {
  const { colors, shadows } = useTheme();
  const [clubId, setClubId] = useState<string | null>(clubs[0]?.id ?? null);
  const [loading, setLoading] = useState(true);
  const [offers, setOffers] = useState<LessonOffer[]>([]);
  const [apps, setApps] = useState<LessonApplicationRow[]>([]);

  // 개설 폼
  const [showForm, setShowForm] = useState(false);
  const [coachName, setCoachName] = useState('');
  const [day, setDay] = useState(2);
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('20:00');
  const [fee, setFee] = useState('');
  const [capacity, setCapacity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clubId && clubs[0]) setClubId(clubs[0].id);
  }, [clubs, clubId]);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const [o, a] = await Promise.all([api.getOffers(clubId), api.getApplications(clubId)]);
      setOffers(o);
      setApps(a);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [clubId, api]);
  useEffect(() => { load(); }, [load]);

  const createOffer = async () => {
    if (!clubId || saving) return;
    if (!coachName.trim()) { showError('코치명을 입력해 주세요'); return; }
    if (!HHMM.test(start) || !HHMM.test(end)) { showError('시간 형식은 HH:mm 이에요'); return; }
    setSaving(true);
    try {
      await api.saveOffer(clubId, { coachName: coachName.trim(), day, start, end, fee: num(fee), capacity: num(capacity) });
      showSuccess('레슨을 개설했어요');
      setShowForm(false);
      setCoachName(''); setFee(''); setCapacity('');
      await load();
    } catch {
      showError('저장에 실패했어요');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (offer: LessonOffer) => {
    if (!clubId) return;
    await api.saveOffer(clubId, { id: offer.id, enabled: !offer.enabled });
    await load();
  };

  const removeOffer = (offer: LessonOffer) =>
    confirmAsk('레슨 삭제', `${offer.coachName} 코치 · ${offer.summary}\n신청 내역도 함께 삭제돼요.`, async () => {
      if (!clubId) return;
      await api.deleteOffer(clubId, offer.id);
      showSuccess('삭제했어요');
      await load();
    });

  const setAppStatus = async (app: LessonApplicationRow, status: string) => {
    if (!clubId) return;
    try {
      await api.updateApplication(clubId, app.id, status);
      if (status === 'CONFIRMED') showSuccess(`${app.name}님 레슨 확정${app.isAppUser ? ' — 알림을 보냈어요' : ''}`);
      await load();
    } catch {
      showError('처리에 실패했어요');
    }
  };

  const activeApps = apps.filter((a) => a.status !== 'CANCELLED');

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
      {/* 클럽 선택(여러 모임 관리 시에만) */}
      {clubs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: spacing.sm }}>
          {clubs.map((c) => {
            const active = c.id === clubId;
            return (
              <Pressable key={c.id} onPress={() => setClubId(c.id)} style={[styles.clubChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border }]}>
                <Text style={[styles.clubChipText, { color: active ? '#fff' : colors.textSecondary }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <>
          {/* 레슨 상품 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>레슨</Text>
              <Pressable onPress={() => setShowForm((v) => !v)} style={[styles.addBtn, { backgroundColor: showForm ? colors.background : colors.primary }]}>
                <Ionicons name={showForm ? 'close' : 'add'} size={16} color={showForm ? colors.textSecondary : '#fff'} />
                <Text style={[styles.addBtnText, { color: showForm ? colors.textSecondary : '#fff' }]}>{showForm ? '닫기' : '레슨 개설'}</Text>
              </Pressable>
            </View>

            {showForm && (
              <View style={[styles.form, { backgroundColor: colors.background }]}>
                <TextInput
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                  value={coachName} onChangeText={setCoachName}
                  placeholder="코치명" placeholderTextColor={colors.textLight} maxLength={20}
                />
                <View style={styles.dayRow}>
                  {DAYS.map((d) => {
                    const active = d.day === day;
                    return (
                      <Pressable key={d.day} onPress={() => setDay(d.day)} style={[styles.dayChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border }]}>
                        <Text style={[styles.dayChipText, { color: active ? '#fff' : colors.textSecondary }]}>{d.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.rowGap}>
                  <TextInput style={[styles.input, styles.flex1, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, textAlign: 'center' }]} value={start} onChangeText={setStart} placeholder="19:00" placeholderTextColor={colors.textLight} maxLength={5} />
                  <Text style={{ color: colors.textLight }}>~</Text>
                  <TextInput style={[styles.input, styles.flex1, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, textAlign: 'center' }]} value={end} onChangeText={setEnd} placeholder="20:00" placeholderTextColor={colors.textLight} maxLength={5} />
                </View>
                <View style={styles.rowGap}>
                  <TextInput style={[styles.input, styles.flex1, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} value={fee} onChangeText={setFee} placeholder="레슨비(원, 선택)" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={8} />
                  <TextInput style={[styles.input, styles.flex1, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} value={capacity} onChangeText={setCapacity} placeholder="정원(선택)" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={3} />
                </View>
                <Pressable onPress={createOffer} disabled={saving} style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}>
                  <Text style={styles.saveBtnText}>{saving ? '저장 중…' : '개설하기'}</Text>
                </Pressable>
              </View>
            )}

            {offers.length === 0 && !showForm ? (
              <Text style={[styles.empty, { color: colors.textLight }]}>아직 개설된 레슨이 없어요. 코치·요일·시간을 정해 개설해 보세요.</Text>
            ) : (
              offers.map((o) => (
                <View key={o.id} style={[styles.offerRow, { borderTopColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.offerTitle, { color: o.enabled ? colors.text : colors.textLight }]}>
                      {o.coachName} 코치 · {o.summary}
                    </Text>
                    <Text style={[styles.offerMeta, { color: colors.textLight }]}>
                      {[o.fee != null && `${o.fee.toLocaleString()}원`, o.capacity != null ? `정원 ${o.capacity}명` : '정원 무제한', `신청 ${o.applicants}명`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Switch value={o.enabled} onValueChange={() => toggleEnabled(o)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.surface} />
                  <Pressable onPress={() => removeOffer(o)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.textLight} />
                  </Pressable>
                </View>
              ))
            )}
          </View>

          {/* 신청 목록 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>레슨 신청 {activeApps.length > 0 ? `(${activeApps.length})` : ''}</Text>
            {apps.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textLight }]}>아직 신청이 없어요. 레슨을 켜 두면 회원이 모임 화면에서 신청할 수 있어요.</Text>
            ) : (
              apps.map((a) => {
                const cancelled = a.status === 'CANCELLED';
                const confirmed = a.status === 'CONFIRMED';
                return (
                  <View key={a.id} style={[styles.appRow, { borderTopColor: colors.border }, cancelled && { opacity: 0.45 }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.appName, { color: colors.text }]}>{a.name}</Text>
                        {a.isAppUser && (
                          <View style={[styles.tag, { backgroundColor: colors.info + '22' }]}>
                            <Text style={[styles.tagText, { color: colors.info }]}>앱 회원</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.offerMeta, { color: colors.textLight }]}>
                        {a.coachName} 코치 · {a.offerSummary}{a.phone ? ` · ${a.phone}` : ''}
                      </Text>
                    </View>
                    {cancelled ? (
                      <Text style={[styles.statusText, { color: colors.textLight }]}>취소됨</Text>
                    ) : confirmed ? (
                      <Pressable onPress={() => setAppStatus(a, 'PENDING')} style={[styles.stateBtn, { backgroundColor: colors.secondary + '22' }]}>
                        <Text style={[styles.stateBtnText, { color: colors.secondary }]}>확정 ✓</Text>
                      </Pressable>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable onPress={() => setAppStatus(a, 'CONFIRMED')} style={[styles.stateBtn, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.stateBtnText, { color: '#fff' }]}>확정</Text>
                        </Pressable>
                        <Pressable onPress={() => setAppStatus(a, 'CANCELLED')} style={[styles.stateBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
                          <Text style={[styles.stateBtnText, { color: colors.textSecondary }]}>취소</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  clubChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  clubChipText: { ...typography.body2, fontWeight: '800' },
  card: { borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { ...typography.subtitle1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  addBtnText: { ...typography.caption, fontWeight: '800' },
  form: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  input: { ...typography.body2, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontWeight: '700' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex1: { flex: 1 },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayChipText: { ...typography.body2, fontWeight: '900' },
  saveBtn: { paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  saveBtnText: { ...typography.button, color: '#fff', fontSize: 14 },
  empty: { ...typography.body2, paddingVertical: spacing.md, lineHeight: 20 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  offerTitle: { ...typography.body2, fontWeight: '800' },
  offerMeta: { ...typography.caption, marginTop: 2 },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  appName: { ...typography.body2, fontWeight: '800' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  tagText: { fontSize: 10, fontWeight: '800' },
  stateBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  stateBtnText: { ...typography.caption, fontWeight: '800' },
  statusText: { ...typography.caption, fontWeight: '700' },
});
