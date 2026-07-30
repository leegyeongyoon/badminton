import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Switch, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { typography, spacing, radius } from '../../constants/theme';
import { showSuccess, showError } from '../../utils/feedback';
import type { LessonApi, LessonOffer, LessonApplicationRow } from '../../services/lab';

// ─────────────────────────────────────────────────────────────
// 레슨 관리(공용) — 실험실(최고관리자)과 모임 관리(운영진) 양쪽에서
// LessonApi 어댑터만 갈아끼워 쓰는 화면.
// 실제 체육관 레슨 구조를 따른다: 코치 프로필(소개·이력) + 요일 묶음
// (월수금/화목) 타임 + 월 레슨비 + 정원(신청 현황 게이지).
// ─────────────────────────────────────────────────────────────

export interface LessonClub {
  id: string;
  name: string;
}

const DAYS = [
  { day: 1, label: '월' }, { day: 2, label: '화' }, { day: 3, label: '수' },
  { day: 4, label: '목' }, { day: 5, label: '금' }, { day: 6, label: '토' }, { day: 0, label: '일' },
];
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
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

  // 개설/수정 폼
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [coachName, setCoachName] = useState('');
  const [coachIntro, setCoachIntro] = useState('');
  const [coachCareer, setCoachCareer] = useState('');
  const [days, setDays] = useState<number[]>([1, 3, 5]); // 기본 월수금
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

  const resetForm = () => {
    setEditingId(null);
    setCoachName(''); setCoachIntro(''); setCoachCareer('');
    setDays([1, 3, 5]); setStart('19:00'); setEnd('20:00'); setFee(''); setCapacity('');
  };

  const openEdit = (o: LessonOffer) => {
    setEditingId(o.id);
    setCoachName(o.coachName);
    setCoachIntro(o.coachIntro ?? '');
    setCoachCareer(o.coachCareer ?? '');
    setDays(o.days);
    setStart(o.start); setEnd(o.end);
    setFee(o.fee != null ? String(o.fee) : '');
    setCapacity(o.capacity != null ? String(o.capacity) : '');
    setShowForm(true);
  };

  const toggleFormDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const saveOffer = async () => {
    if (!clubId || saving) return;
    if (!coachName.trim()) { showError('코치명을 입력해 주세요'); return; }
    if (days.length === 0) { showError('레슨 요일을 선택해 주세요'); return; }
    if (!HHMM.test(start) || !HHMM.test(end)) { showError('시간 형식은 HH:mm 이에요'); return; }
    setSaving(true);
    try {
      await api.saveOffer(clubId, {
        ...(editingId ? { id: editingId } : {}),
        coachName: coachName.trim(),
        coachIntro: coachIntro.trim() || null,
        coachCareer: coachCareer.trim() || null,
        days, start, end,
        fee: num(fee), capacity: num(capacity),
      });
      showSuccess(editingId ? '레슨을 수정했어요' : '레슨을 개설했어요');
      setShowForm(false);
      resetForm();
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
    showSuccess(offer.enabled ? '레슨을 숨겼어요 (회원에게 안 보임)' : '레슨을 공개했어요');
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
      await api.updateApplication(clubId, app.id, { status });
      if (status === 'CONFIRMED') showSuccess(`${app.name}님 레슨 확정${app.isAppUser ? ' — 알림을 보냈어요' : ''}`);
      else if (status === 'CANCELLED') showSuccess(`${app.name}님 신청을 취소했어요`);
      await load();
    } catch {
      showError('처리에 실패했어요');
    }
  };

  const toggleFeePaid = async (app: LessonApplicationRow) => {
    if (!clubId) return;
    try {
      await api.updateApplication(clubId, app.id, { feePaid: !app.feePaid });
      showSuccess(app.feePaid ? '입금확인을 취소했어요' : `${app.name}님 레슨비 입금확인 ✓`);
      await load();
    } catch {
      showError('처리에 실패했어요');
    }
  };

  const activeApps = apps.filter((a) => a.status !== 'CANCELLED');

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80, maxWidth: 640, width: '100%' as const, alignSelf: 'center' as const }} keyboardShouldPersistTaps="handled">
      {/* 클럽 선택(여러 모임 관리 시에만) */}
      {clubs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: spacing.sm }}>
          {clubs.map((c) => {
            const active = c.id === clubId;
            return (
              <Pressable key={c.id} onPress={() => setClubId(c.id)} style={[styles.clubChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface }]}>
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
          {/* 헤더 + 개설 버튼 */}
          <View style={styles.headRow}>
            <View>
              <Text style={[styles.headTitle, { color: colors.text }]}>레슨 {offers.length > 0 ? `(${offers.length})` : ''}</Text>
              <Text style={[styles.headHint, { color: colors.textLight }]}>코치·요일·월 레슨비·정원으로 운영해요</Text>
            </View>
            <Pressable
              onPress={() => { if (showForm) { setShowForm(false); resetForm(); } else setShowForm(true); }}
              style={[styles.addBtn, { backgroundColor: showForm ? colors.background : colors.primary }, !showForm && shadows.sm]}
            >
              <Ionicons name={showForm ? 'close' : 'add'} size={18} color={showForm ? colors.textSecondary : '#fff'} />
              <Text style={[styles.addBtnText, { color: showForm ? colors.textSecondary : '#fff' }]}>{showForm ? '닫기' : '레슨 개설'}</Text>
            </Pressable>
          </View>

          {/* 개설/수정 폼 */}
          {showForm && (
            <View style={[styles.formCard, { backgroundColor: colors.surface }, shadows.sm]}>
              <Text style={[styles.formTitle, { color: colors.text }]}>{editingId ? '레슨 수정' : '새 레슨'}</Text>

              <Text style={[styles.label, { color: colors.textSecondary }]}>코치명 <Text style={{ color: colors.danger }}>*</Text></Text>
              <TextInput style={[styles.input, { color: colors.text, backgroundColor: colors.background }]} value={coachName} onChangeText={setCoachName} placeholder="예: 박성우" placeholderTextColor={colors.textLight} maxLength={20} />

              <Text style={[styles.label, { color: colors.textSecondary }]}>한 줄 소개</Text>
              <TextInput style={[styles.input, { color: colors.text, backgroundColor: colors.background }]} value={coachIntro} onChangeText={setCoachIntro} placeholder="예: 전 실업팀 선수 출신 · 지도 경력 10년" placeholderTextColor={colors.textLight} maxLength={60} />

              <Text style={[styles.label, { color: colors.textSecondary }]}>이력·경력 (줄바꿈으로 구분)</Text>
              <TextInput
                style={[styles.input, styles.multiline, { color: colors.text, backgroundColor: colors.background }]}
                value={coachCareer} onChangeText={setCoachCareer}
                placeholder={'예:\n전국체전 단체전 금메달\n생활체육지도자 2급\n○○체육관 전임 코치'}
                placeholderTextColor={colors.textLight} multiline numberOfLines={4} maxLength={500}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>레슨 요일 <Text style={{ color: colors.danger }}>*</Text>  <Text style={{ color: colors.textLight }}>(월수금·화목처럼 여러 개 선택)</Text></Text>
              <View style={styles.dayRow}>
                {DAYS.map((d) => {
                  const active = days.includes(d.day);
                  return (
                    <Pressable key={d.day} onPress={() => toggleFormDay(d.day)} style={[styles.dayChip, active ? { backgroundColor: colors.primary } : { backgroundColor: colors.background }]}>
                      <Text style={[styles.dayChipText, { color: active ? '#fff' : colors.textSecondary }]}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: colors.textSecondary }]}>레슨 시간 <Text style={{ color: colors.danger }}>*</Text></Text>
              <View style={styles.rowGap}>
                <TextInput style={[styles.input, styles.flex1, styles.center, { color: colors.text, backgroundColor: colors.background }]} value={start} onChangeText={setStart} placeholder="19:00" placeholderTextColor={colors.textLight} maxLength={5} />
                <Text style={{ color: colors.textLight }}>~</Text>
                <TextInput style={[styles.input, styles.flex1, styles.center, { color: colors.text, backgroundColor: colors.background }]} value={end} onChangeText={setEnd} placeholder="20:00" placeholderTextColor={colors.textLight} maxLength={5} />
              </View>

              <View style={styles.rowGap}>
                <View style={styles.flex1}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>월 레슨비(원)</Text>
                  <TextInput style={[styles.input, { color: colors.text, backgroundColor: colors.background }]} value={fee} onChangeText={setFee} placeholder="예: 200000" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={8} />
                </View>
                <View style={styles.flex1}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>정원(명)</Text>
                  <TextInput style={[styles.input, { color: colors.text, backgroundColor: colors.background }]} value={capacity} onChangeText={setCapacity} placeholder="비우면 무제한" placeholderTextColor={colors.textLight} keyboardType="number-pad" maxLength={3} />
                </View>
              </View>

              <Pressable onPress={saveOffer} disabled={saving} style={[styles.saveBtn, { backgroundColor: colors.primary }, shadows.colored(colors.primary), saving && { opacity: 0.7 }]}>
                <Text style={styles.saveBtnText}>{saving ? '저장 중…' : editingId ? '수정 저장' : '개설하기'}</Text>
              </Pressable>
            </View>
          )}

          {/* 코치 카드 목록 */}
          {offers.length === 0 && !showForm ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.surface }, shadows.sm]}>
              <Ionicons name="school-outline" size={32} color={colors.textLight} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 개설된 레슨이 없어요</Text>
              <Text style={[styles.emptyHint, { color: colors.textLight }]}>코치 프로필과 요일·시간·레슨비를 넣어 개설하면{'\n'}회원이 모임 화면에서 바로 신청할 수 있어요</Text>
            </View>
          ) : (
            offers.map((o) => {
              const careerLines = (o.coachCareer ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
              const ratio = o.capacity ? Math.min(1, o.applicants / o.capacity) : 0;
              const full = o.capacity != null && o.applicants >= o.capacity;
              return (
                <View key={o.id} style={[styles.coachCard, { backgroundColor: colors.surface }, shadows.md, !o.enabled && { opacity: 0.55 }]}>
                  <View style={styles.coachHead}>
                    <View style={[styles.avatar, { backgroundColor: colors.primary + '22' }]}>
                      <Text style={[styles.avatarText, { color: colors.primary }]}>{o.coachName.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.coachName, { color: colors.text }]}>{o.coachName} 코치</Text>
                        {!o.enabled && (
                          <View style={[styles.hiddenTag, { backgroundColor: colors.background }]}>
                            <Text style={[styles.hiddenTagText, { color: colors.textLight }]}>숨김</Text>
                          </View>
                        )}
                      </View>
                      {!!o.coachIntro && <Text style={[styles.coachIntro, { color: colors.textSecondary }]} numberOfLines={1}>{o.coachIntro}</Text>}
                    </View>
                    <Switch value={o.enabled} onValueChange={() => toggleEnabled(o)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.surface} />
                  </View>

                  {careerLines.length > 0 && (
                    <View style={[styles.careerBox, { backgroundColor: colors.background }]}>
                      {careerLines.slice(0, 4).map((l, i) => (
                        <Text key={i} style={[styles.careerLine, { color: colors.textSecondary }]}>· {l}</Text>
                      ))}
                    </View>
                  )}

                  {/* 요일 + 시간 + 레슨비 */}
                  <View style={styles.metaRow}>
                    <View style={styles.dayBadges}>
                      {o.days.map((d) => (
                        <View key={d} style={[styles.dayBadge, { backgroundColor: colors.primary + '18' }]}>
                          <Text style={[styles.dayBadgeText, { color: colors.primary }]}>{DAY_KO[d]}</Text>
                        </View>
                      ))}
                      <Text style={[styles.timeText, { color: colors.text }]}>{o.start}~{o.end}</Text>
                    </View>
                    {o.fee != null && <Text style={[styles.feeText, { color: colors.text }]}>월 {o.fee.toLocaleString()}원</Text>}
                  </View>

                  {/* 정원 게이지 */}
                  <View style={styles.gaugeRow}>
                    <View style={[styles.gaugeTrack, { backgroundColor: colors.background }]}>
                      <View style={[styles.gaugeFill, { width: `${o.capacity ? Math.round(ratio * 100) : o.applicants > 0 ? 100 : 0}%`, backgroundColor: full ? colors.warning : colors.primary }]} />
                    </View>
                    <Text style={[styles.gaugeText, { color: full ? colors.warning : colors.textSecondary }]}>
                      {o.capacity != null ? `${o.applicants}/${o.capacity}명${full ? ' 마감' : ''}` : `신청 ${o.applicants}명`}
                    </Text>
                  </View>

                  <View style={styles.cardActions}>
                    <Pressable onPress={() => openEdit(o)} style={[styles.editBtn, { backgroundColor: colors.background }]}>
                      <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
                      <Text style={[styles.editBtnText, { color: colors.textSecondary }]}>수정</Text>
                    </Pressable>
                    <Pressable onPress={() => removeOffer(o)} style={[styles.editBtn, { backgroundColor: colors.background }]}>
                      <Ionicons name="trash-outline" size={14} color={colors.danger} />
                      <Text style={[styles.editBtnText, { color: colors.danger }]}>삭제</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}

          {/* 신청 목록 */}
          <View style={[styles.card, { backgroundColor: colors.surface }, shadows.sm]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>레슨 신청 {activeApps.length > 0 ? `(${activeApps.length})` : ''}</Text>
            {apps.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textLight }]}>아직 신청이 없어요. 레슨을 공개해 두면 회원이 모임 화면에서 신청할 수 있어요.</Text>
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
                      <Text style={[styles.appMeta, { color: colors.textLight }]}>
                        {a.coachName} 코치 · {a.offerSummary}{a.phone ? ` · ${a.phone}` : ''}
                      </Text>
                    </View>
                    {cancelled ? (
                      <Text style={[styles.statusText, { color: colors.textLight }]}>취소됨</Text>
                    ) : confirmed ? (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          onPress={() => toggleFeePaid(a)}
                          style={[styles.stateBtn, a.feePaid ? { backgroundColor: colors.secondary } : { backgroundColor: colors.warning + '22' }]}
                        >
                          <Text style={[styles.stateBtnText, { color: a.feePaid ? '#fff' : colors.warning }]}>
                            {a.feePaid ? '입금 ✓' : '입금확인'}
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => setAppStatus(a, 'PENDING')} style={[styles.stateBtn, { backgroundColor: colors.secondary + '22' }]}>
                          <Text style={[styles.stateBtnText, { color: colors.secondary }]}>확정 ✓</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable onPress={() => setAppStatus(a, 'CONFIRMED')} style={[styles.stateBtn, { backgroundColor: colors.primary }]}>
                          <Text style={[styles.stateBtnText, { color: '#fff' }]}>확정</Text>
                        </Pressable>
                        <Pressable onPress={() => setAppStatus(a, 'CANCELLED')} style={[styles.stateBtn, { backgroundColor: colors.background }]}>
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
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  headTitle: { ...typography.h3 },
  headHint: { ...typography.caption, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  addBtnText: { ...typography.body2, fontWeight: '800' },
  formCard: { borderRadius: 20, padding: spacing.lg, marginBottom: spacing.md },
  formTitle: { ...typography.subtitle1, marginBottom: spacing.sm },
  label: { ...typography.caption, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  input: { ...typography.body2, borderRadius: 13, paddingHorizontal: spacing.md, paddingVertical: 12, fontWeight: '700' },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  rowGap: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  flex1: { flex: 1 },
  center: { textAlign: 'center' },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayChipText: { ...typography.body2, fontWeight: '900' },
  saveBtn: { paddingVertical: 15, borderRadius: 15, alignItems: 'center', marginTop: spacing.md },
  saveBtnText: { ...typography.button, color: '#fff' },
  emptyCard: { borderRadius: radius.card, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  emptyTitle: { ...typography.subtitle1 },
  emptyHint: { ...typography.caption, textAlign: 'center', lineHeight: 18 },
  coachCard: { borderRadius: 20, padding: spacing.lg, marginBottom: spacing.md },
  coachHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '900' },
  coachName: { ...typography.subtitle1 },
  coachIntro: { ...typography.caption, marginTop: 2 },
  hiddenTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  hiddenTagText: { fontSize: 10, fontWeight: '800' },
  careerBox: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, gap: 3 },
  careerLine: { ...typography.caption, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, gap: spacing.sm, flexWrap: 'wrap' },
  dayBadges: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  dayBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayBadgeText: { fontSize: 12, fontWeight: '900' },
  timeText: { ...typography.body2, fontWeight: '800', marginLeft: 4 },
  feeText: { ...typography.subtitle2, fontWeight: '900' },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  gaugeTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  gaugeFill: { height: 8, borderRadius: 4 },
  gaugeText: { ...typography.caption, fontWeight: '800', minWidth: 60, textAlign: 'right' },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  editBtnText: { ...typography.caption, fontWeight: '800' },
  card: { borderRadius: 20, padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { ...typography.subtitle1, marginBottom: spacing.xs },
  empty: { ...typography.body2, paddingVertical: spacing.md, lineHeight: 20 },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  appName: { ...typography.body2, fontWeight: '800' },
  appMeta: { ...typography.caption, marginTop: 2 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  tagText: { fontSize: 10, fontWeight: '800' },
  stateBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  stateBtnText: { ...typography.caption, fontWeight: '800' },
  statusText: { ...typography.caption, fontWeight: '700' },
});
